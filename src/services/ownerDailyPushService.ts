import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { Env } from "../config/env.js";
import { getJstDateString } from "../lib/date.js";
import { chunkLineText, pushMessages } from "../lib/line.js";
import { logger } from "../lib/logger.js";
import * as logService from "./logService.js";
import * as reportService from "./reportService.js";

export type OwnerDailyPushResult =
  | { ok: true; report_date: string; pushed: true; message_count: number; idempotency_recorded: boolean }
  | { ok: true; report_date: string; pushed: false; reason: string }
  | { ok: false; error: string };

function isOwnerDailyPushEnabled(env: Env): boolean {
  const ownerId = env.LINE_OWNER_USER_ID.trim();
  if (!ownerId) return false;
  const flag = (process.env.DAILY_OWNER_PUSH_ENABLED ?? "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") return false;
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
  const ownerId = params.env.LINE_OWNER_USER_ID.trim();
  if (!ownerId) {
    return { ok: true, report_date: getJstDateString(), pushed: false, reason: "LINE_OWNER_USER_ID が未設定です" };
  }

  const reportDate = getJstDateString(new Date());
  let row = await logService.getDailyReportByDate(params.supabase, reportDate);

  if (row?.owner_line_pushed_at && !params.force) {
    return {
      ok: true,
      report_date: reportDate,
      pushed: false,
      reason: "本日分は既にオーナーへ push 済みです",
    };
  }

  if (!row) {
    await reportService.generateAndStoreDailyReport({
      supabase: params.supabase,
      openai: params.openai,
      model: params.env.OPENAI_MODEL,
      reportDate,
    });
    row = await logService.getDailyReportByDate(params.supabase, reportDate);
  }

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

  const idempotencyRecorded = await logService.markDailyReportOwnerLinePushed(params.supabase, reportDate);
  if (!idempotencyRecorded) {
    logger.warn(
      "日次監査 push 済みの記録に失敗（rits_schema_migrations/005 を適用すると同日の二重送信を防げます）",
      { report_date: reportDate },
    );
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
