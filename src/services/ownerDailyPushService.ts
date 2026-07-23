import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { Env } from "../config/env.js";
import { getJstDateString } from "../lib/date.js";
import { getUtcIso24HoursAgo } from "../lib/date.js";
import { chunkLineText, pushMessages } from "../lib/line.js";
import { logger } from "../lib/logger.js";
import * as auditService from "./auditService.js";
import * as logService from "./logService.js";
import * as reportService from "./reportService.js";
import { syncCustomerSafetyFindingsToLedger } from "./customerSafetyLedgerService.js";
import { ingestMessageFeedToAgentLogs } from "./messageFeedIngestService.js";
import { runDeterministicRuleAudit } from "./ruleAuditService.js";
import { syncSentryIssuesToQualityLedger } from "./sentryLedgerService.js";

const DAILY_AUDIT_TARGET_AGENTS = ["NEAR", "SERA", "IRIE", "LRAM"];

function dailyAuditBeforeReportEnabled(): boolean {
  const flag = (process.env.DAILY_AUDIT_BEFORE_REPORT ?? "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") return false;
  return true; // 既定 ON
}

function dailyAuditLimitPerAgent(): number {
  const raw = Number.parseInt((process.env.DAILY_AUDIT_LIMIT_PER_AGENT ?? "").trim(), 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return raw;
  return 10;
}

export type OwnerDailyPushResult =
  | { ok: true; report_date: string; pushed: true; message_count: number; idempotency_recorded: boolean }
  | { ok: true; report_date: string; pushed: false; reason: string }
  | { ok: false; error: string };

function isOwnerDailyPushEnabled(env: Env): boolean {
  const ownerId = env.LINE_OWNER_USER_ID.trim();
  if (!ownerId) return false;
  const flag = (process.env.DAILY_OWNER_PUSH_ENABLED ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  // Render 本番は Cron（rits-daily-owner-push）に任せる。未設定で Web スケジューラを起動しない
  if (process.env.RENDER) return false;
  return true;
}

export function getDailyOwnerPushTimeJst(): { hour: number; minute: number } {
  const raw = (process.env.DAILY_OWNER_PUSH_TIME_JST ?? "09:00").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return { hour: 9, minute: 0 };
  const hour = Number.parseInt(m[1] ?? "9", 10);
  const minute = Number.parseInt(m[2] ?? "0", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 9, minute: 0 };
  }
  return { hour, minute };
}

export function getJstHourMinute(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

/**
 * 日次レポートを生成（なければ作成）し、LINE_OWNER_USER_ID に push する
 */
export async function pushDailyReportToOwner(params: {
  env: Env;
  supabase: SupabaseClient;
  openai: OpenAI;
  force?: boolean;
}): Promise<OwnerDailyPushResult> {
  if (ownerPushInFlight && !params.force) {
    return ownerPushInFlight;
  }

  const run = pushDailyReportToOwnerInner(params);
  if (!params.force) {
    ownerPushInFlight = run;
    void run.finally(() => {
      if (ownerPushInFlight === run) ownerPushInFlight = null;
    });
  }
  return run;
}

async function pushDailyReportToOwnerInner(params: {
  env: Env;
  supabase: SupabaseClient;
  openai: OpenAI;
  force?: boolean;
}): Promise<OwnerDailyPushResult> {
  const ownerId = params.env.LINE_OWNER_USER_ID.trim();
  if (!ownerId) {
    return { ok: true, report_date: getJstDateString(), pushed: false, reason: "LINE_OWNER_USER_ID が未設定です" };
  }

  const reportDate = getJstDateString(new Date());

  if (!params.force) {
    const rowEarly = await logService.getDailyReportByDate(params.supabase, reportDate);
    if (rowEarly?.owner_line_pushed_at) {
      return {
        ok: true,
        report_date: reportDate,
        pushed: false,
        reason: "本日分は既にオーナーへ push 済みです",
      };
    }
    if (await logService.hasDailyOwnerLinePushMarker(params.supabase, reportDate)) {
      return {
        ok: true,
        report_date: reportDate,
        pushed: false,
        reason: "本日分は既にオーナーへ push 済みです（005 未適用時のマーカー）",
      };
    }
  }

  // 正規 message_feed → agent_logs（既存 LLM 監査へ接続）。失敗しても続行。
  try {
    const ingest = await ingestMessageFeedToAgentLogs({
      supabase: params.supabase,
      sinceIso: getUtcIso24HoursAgo(new Date()),
    });
    if (ingest.created > 0 || ingest.pairs > 0) {
      logger.info("message_feed を agent_logs へ取り込み", ingest);
    }
  } catch (e) {
    logger.warn("message_feed 取り込みに失敗（続行）", { err: String(e) });
  }

  // レポート生成前に、直近24hの未監査ログを LLM 監査する（audit_highlights を空にしない）。
  // 失敗しても日次 push 自体は続行する。
  if (dailyAuditBeforeReportEnabled()) {
    try {
      const audited = await auditService.runUnauditedAuditsForAgents({
        supabase: params.supabase,
        openai: params.openai,
        model: params.env.OPENAI_MODEL,
        agentNames: DAILY_AUDIT_TARGET_AGENTS,
        sinceIso: getUtcIso24HoursAgo(new Date()),
        maxPerAgent: dailyAuditLimitPerAgent(),
      });
      logger.info("日次バッチ監査を実行しました", { audited });
    } catch (e) {
      logger.error("日次バッチ監査に失敗（レポート生成は続行）", { err: String(e) });
    }
  }

  // 決定的ルール監査（無応答・handoff ギャップ等）
  try {
    const rules = await runDeterministicRuleAudit({
      sinceIso: getUtcIso24HoursAgo(new Date()),
    });
    if (rules.findingsCreated > 0 || rules.tasksCreated > 0) {
      logger.info("決定的ルール監査を品質台帳へ同期", rules);
    }
  } catch (e) {
    logger.warn("決定的ルール監査に失敗（続行）", { err: String(e) });
  }

  // 顧客横断セーフティを品質台帳へ（失敗しても続行）
  try {
    const safety = await syncCustomerSafetyFindingsToLedger();
    if (safety.findingsCreated > 0 || safety.tasksCreated > 0) {
      logger.info("顧客セーフティ finding を品質台帳へ同期", safety);
    }
  } catch (e) {
    logger.warn("顧客セーフティ同期に失敗（続行）", { err: String(e) });
  }

  // Sentry 未解決 → 品質台帳（トークン未設定なら no-op）
  try {
    const sentry = await syncSentryIssuesToQualityLedger();
    if (sentry.findingsCreated > 0 || sentry.tasksCreated > 0) {
      logger.info("Sentry finding を品質台帳へ同期", sentry);
    }
  } catch (e) {
    logger.warn("Sentry 同期に失敗（続行）", { err: String(e) });
  }

  // 【24h 活動】と ■ 各部署 の文言を一致させる（朝の生成結果をそのまま push しない）
  await reportService.generateAndStoreDailyReport({
    supabase: params.supabase,
    openai: params.openai,
    model: params.env.OPENAI_MODEL,
    reportDate,
  });
  const row = await logService.getDailyReportByDate(params.supabase, reportDate);

  if (!row) {
    return { ok: false, error: "日次レポートの取得に失敗しました" };
  }

  const body = await reportService.formatDailyReportForLine(row, { supabase: params.supabase });
  const chunks = chunkLineText(body, 4500);
  const pushRes = await pushMessages({
    channelAccessToken: params.env.LINE_CHANNEL_ACCESS_TOKEN,
    to: ownerId,
    texts: chunks,
  });

  if (!pushRes.ok) {
    await logService.createSystemError(params.supabase, {
      source: "ownerDailyPushService.pushMessages",
      error_message: `LINE push failed: HTTP ${pushRes.results.map((r) => r.status).join(",")}`,
      severity: "high",
      metadata: { report_date: reportDate, owner_id_prefix: ownerId.slice(0, 8) },
    });
    return { ok: false, error: "LINE push に失敗しました（Render ログを確認）" };
  }

  let idempotencyRecorded = await logService.markDailyReportOwnerLinePushed(params.supabase, reportDate);
  if (!idempotencyRecorded) {
    try {
      await logService.recordDailyOwnerLinePushMarker(params.supabase, reportDate);
      idempotencyRecorded = true;
    } catch (e) {
      logger.warn(
        "日次監査 push 済みの記録に失敗（rits_schema_migrations/005 を適用すると同日の二重送信を防げます）",
        { report_date: reportDate, err: String(e) },
      );
    }
  }
  logger.info("日次監査をオーナーへ push しました", {
    report_date: reportDate,
    message_count: chunks.length,
    idempotency_recorded: idempotencyRecorded,
  });

  return {
    ok: true,
    report_date: reportDate,
    pushed: true,
    message_count: chunks.length,
    idempotency_recorded: idempotencyRecorded,
  };
}

let schedulerLastFiredJstDate: string | null = null;
/** 同一プロセス内の push-owner 同時実行を防ぐ（Cron + Web スケジューラのレース対策） */
let ownerPushInFlight: Promise<OwnerDailyPushResult> | null = null;

/** Asia/Tokyo の指定時刻（既定 09:00）に 1 日 1 回 push */
export function startDailyOwnerPushScheduler(params: {
  env: Env;
  getSupabase: () => SupabaseClient | null;
  getOpenai: () => OpenAI;
}): void {
  if (!isOwnerDailyPushEnabled(params.env)) {
    logger.info("日次オーナーLINE push: 無効（LINE_OWNER_USER_ID 未設定または DAILY_OWNER_PUSH_ENABLED=false）");
    return;
  }

  const target = getDailyOwnerPushTimeJst();
  logger.info("日次オーナーLINE push: スケジューラ起動", {
    time_jst: `${String(target.hour).padStart(2, "0")}:${String(target.minute).padStart(2, "0")}`,
    owner_id_set: true,
  });

  const tick = (): void => {
    const now = new Date();
    const jstDate = getJstDateString(now);
    const { hour, minute } = getJstHourMinute(now);
    if (hour !== target.hour || minute !== target.minute) return;
    if (schedulerLastFiredJstDate === jstDate) return;
    schedulerLastFiredJstDate = jstDate;

    const supabase = params.getSupabase();
    if (!supabase) {
      logger.warn("日次オーナーLINE push: Supabase 未接続のためスキップ", { report_date: jstDate });
      return;
    }

    void pushDailyReportToOwner({
      env: params.env,
      supabase,
      openai: params.getOpenai(),
    }).then((r) => {
      if (!r.ok) {
        logger.error("日次オーナーLINE push 失敗", { err: r.error });
      } else if (r.pushed) {
        logger.info("日次オーナーLINE push 完了", { report_date: r.report_date, messages: r.message_count });
      } else {
        logger.info("日次オーナーLINE push スキップ", { reason: r.reason });
      }
    });
  };

  setInterval(tick, 60_000);
  tick();
}
