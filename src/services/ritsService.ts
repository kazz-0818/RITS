import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { AgentAuditRow } from "../types/audit.js";
import type { LineMessageEvent } from "../types/line.js";
import type { Env } from "../config/env.js";
import { getJstDateString } from "../lib/date.js";
import { chunkLineText, pushMessages, replyMessage } from "../lib/line.js";
import { generateText } from "../lib/openai.js";
import { buildRitsCapabilitiesHelpReply } from "../lib/capabilitiesHelp.js";
import { buildRitsSystemPrompt } from "../prompts/ritsSystemPrompt.js";
import { classifyLineCommand } from "./commandService.js";
import * as logService from "./logService.js";
import * as reportService from "./reportService.js";
import { logger } from "../lib/logger.js";

export type RitsDeps = {
  env: Env;
  supabase: SupabaseClient;
  openai: OpenAI;
};

const MAX_LOG_FIELD = 4000;

function clipLogField(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_LOG_FIELD) return t;
  return `${t.slice(0, MAX_LOG_FIELD)}…`;
}

function lineLogMetadataFromSource(source?: LineMessageEvent["source"]): Record<string, unknown> {
  if (!source) return {};
  const meta: Record<string, unknown> = { line_source_type: source.type };
  if (source.userId) meta.actor_user_id = source.userId;
  const ext = source as { groupId?: string; roomId?: string };
  if (ext.groupId) meta.group_id = ext.groupId;
  if (ext.roomId) meta.room_id = ext.roomId;
  return meta;
}

type RitsLineLogContext = {
  userText: string;
  intent?: string;
  lineSource?: LineMessageEvent["source"];
};

/** push API の宛先（1:1 は userId、グループ/ルームは groupId/roomId） */
function linePushTargetFromSource(source?: LineMessageEvent["source"]): string | null {
  if (!source) return null;
  const ext = source as { userId?: string; groupId?: string; roomId?: string };
  if (source.type === "group" && ext.groupId) return ext.groupId;
  if (source.type === "room" && ext.roomId) return ext.roomId;
  return ext.userId ?? null;
}

/**
 * LINE reply の結果を検査し、失敗時は system_errors に残す（Render ログだけでは気づきにくいため）。
 * コールドスリープ復帰・Webhook 再配送で reply token が失効していた場合は push にフォールバックし、
 * 無返信を防ぐ。
 */
async function sendLineReply(
  deps: RitsDeps,
  replyToken: string,
  texts: string[],
  context: string,
  logContext?: RitsLineLogContext,
): Promise<void> {
  const normalized = texts.filter((t) => t.trim().length > 0);
  const toSend = (normalized.length > 0 ? normalized : ["（応答が空でした）"]).slice(0, 5);
  let res = await replyMessage({
    channelAccessToken: deps.env.LINE_CHANNEL_ACCESS_TOKEN,
    replyToken,
    texts: toSend,
  });
  if (!res.ok) {
    const pushTo = linePushTargetFromSource(logContext?.lineSource);
    if (pushTo) {
      logger.warn("LINE reply 失敗 → push にフォールバック", { context, status: res.status });
      const pushed = await pushMessages({
        channelAccessToken: deps.env.LINE_CHANNEL_ACCESS_TOKEN,
        to: pushTo,
        texts: toSend,
      });
      if (pushed.ok) {
        res = { ok: true, status: 200, body: "(delivered via push fallback)" };
      }
    }
  }
  if (logContext && res.ok) {
    void logService
      .createAgentLog(deps.supabase, {
        agent_name: "RITS",
        user_message: clipLogField(logContext.userText),
        agent_reply: clipLogField(toSend.join("\n\n")),
        intent: logContext.intent ?? context,
        source: "line",
        metadata: lineLogMetadataFromSource(logContext.lineSource),
      })
      .catch((e) => logger.warn("RITS self LINE log failed (non-fatal)", { err: String(e) }));
  }
  if (!res.ok) {
    logger.warn("LINE reply API が失敗しました", { context, status: res.status });
    try {
      await logService.createSystemError(deps.supabase, {
        source: `ritsService.${context}`,
        error_message: `LINE reply HTTP ${res.status}`,
        stack_trace: undefined,
        severity: "high",
        metadata: { line_body: res.body.slice(0, 2500) },
      });
    } catch (e) {
      logger.error("system_errors への記録に失敗", { err: String(e) });
    }
  }
}

/** LINE に載せる前に、よくある秘密・長い JWT をマスクする */
function redactForUserMessage(s: string): string {
  return s
    .replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, "sk-***")
    .replace(/\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, "eyJ***")
    .replace(/service_role["\s:]+[a-zA-Z0-9._-]{20,}/gi, "service_role ***");
}

/**
 * 例外をユーザー向け短文に変換（原因切り分け用。秘密は出さない）
 */
function userFacingRitsErrorLines(e: unknown, appBaseUrl: string): string[] {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.toLowerCase();

  if (
    m.includes("incorrect api key") ||
    m.includes("invalid_api_key") ||
    m.includes("invalid api key") ||
    (m.includes("401") && (m.includes("openai") || m.includes("authentication")))
  ) {
    return ["RITS: OpenAI の API キーが無効です。Render の OPENAI_API_KEY を https://platform.openai.com で発行した値に差し替えてください。"];
  }

  if (
    m.includes("model_not_found") ||
    (m.includes("model") && m.includes("does not exist")) ||
    (m.includes("model") && (m.includes("not found") || m.includes("invalid") || m.includes("unknown")))
  ) {
    return [
      "RITS: OPENAI_MODEL が使えません。Render で `gpt-4o-mini` など実在するモデルに変更してください（現在の値はログに残っています）。",
    ];
  }

  if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) {
    return ["RITS: OpenAI のレート制限です。少し待ってから再送してください。"];
  }

  if (m.includes("quota") || m.includes("billing") || m.includes("exceeded your current quota")) {
    return ["RITS: OpenAI の利用枠・請求（クレジット）を確認してください。"];
  }

  if (
    m.includes("pgrst205") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    (m.includes("does not exist") &&
      (m.includes("relation") || m.includes("agent_") || m.includes("public.") || m.includes("table")))
  ) {
    const base = appBaseUrl.replace(/\/+$/, "");
    return [
      "RITS: Supabase の必須テーブルにアクセスできていません（別プロジェクトの URL / 未実行の rits_schema_migrations / キー誤りが多いです）。",
      `ブラウザで ${base}/health と ${base}/health/supabase-tables を確認してください（project_ref・jwt_role・missing_tables）。`,
    ];
  }

  if (m.includes("createSystemError failed")) {
    return [
      "RITS: エラー記録用テーブル（system_errors）への書き込みに失敗しました。Supabase のプロジェクトが Render と一致しているか、RLS を service_role で通る状態か確認してください。",
    ];
  }

  const tail = redactForUserMessage(raw).slice(0, 380);
  return [`RITS: 処理に失敗しました。`, `（サーバー: ${tail}${raw.length > 380 ? "…" : ""}）`];
}

function isHighRisk(audit: { risk_level: string | null }): boolean {
  const r = (audit.risk_level ?? "").toLowerCase();
  return r === "high" || r === "critical";
}

function formatAuditsForLine(agentLabel: string, audits: AgentAuditRow[]): string {
  if (audits.length === 0) {
    return `${agentLabel}の直近監査結果は見つかりませんでした。先に /admin/logs と /admin/audit/run を実行し、Supabaseに監査を蓄積してください。`;
  }

  const lines: string[] = [];
  lines.push(`【RITS：${agentLabel} 監査サマリ】`);
  lines.push("");

  for (const a of audits.slice(0, 8)) {
    lines.push(`- (${a.created_at}) score=${a.score ?? "?"} grade=${a.grade ?? "?"} risk=${a.risk_level ?? "?"}`);
    lines.push(`  issue: ${a.issue_type ?? "?"}`);
    lines.push(`  summary: ${(a.summary ?? "").slice(0, 420)}`);
    lines.push(`  improvement: ${(a.improvement ?? "").slice(0, 420)}`);
    lines.push("");
  }

  lines.push("必要なら、該当ログIDを特定して深掘りします（Supabaseのagent_logs / agent_auditsを参照）。");
  return lines.join("\n");
}

async function buildOwnerContext(deps: RitsDeps): Promise<string> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const audits = await logService.getAuditsSince(deps.supabase, { sinceIso, limit: 200 });
  const unsupported = await logService.getOpenUnsupportedRequests(deps.supabase, { limit: 30 });

  const high = audits.filter(isHighRisk).length;
  return [
    "以下はSupabaseから取得した要約統計です（正の情報源）。",
    `- audits_24h: ${audits.length}（high/critical相当の件数: ${high}）`,
    `- unsupported_open: ${unsupported.length}`,
  ].join("\n");
}

export async function handleRitsLineText(params: {
  deps: RitsDeps;
  replyToken: string;
  text: string;
  lineSource?: LineMessageEvent["source"];
}): Promise<void> {
  const cmd = classifyLineCommand(params.text);
  const lineLog = (intent?: string): RitsLineLogContext => ({
    userText: params.text,
    intent: intent ?? cmd.type,
    lineSource: params.lineSource,
  });

  try {
    if (cmd.type === "DAILY_REPORT") {
      const reportDate = getJstDateString(new Date());
      let row = await logService.getDailyReportByDate(params.deps.supabase, reportDate);
      if (!row) {
        await reportService.generateAndStoreDailyReport({
          supabase: params.deps.supabase,
          openai: params.deps.openai,
          model: params.deps.env.OPENAI_MODEL,
          reportDate,
        });
        row = await logService.getDailyReportByDate(params.deps.supabase, reportDate);
      }
      const body = row
        ? await reportService.formatDailyReportForLine(row, { supabase: params.deps.supabase })
        : "日次レポートの生成に失敗しました。";
      const chunks = chunkLineText(body, 4500).slice(0, 5);
      await sendLineReply(params.deps, params.replyToken, chunks, "DAILY_REPORT", lineLog("DAILY_REPORT"));
      return;
    }

    if (cmd.type === "AGENT_ISSUES") {
      const agent = cmd.agent ?? "SERA";
      const audits = await logService.getAuditsByAgent(params.deps.supabase, { agent_name: agent, limit: 12 });
      const msg = formatAuditsForLine(agent, audits);
      const chunks = chunkLineText(msg, 4500).slice(0, 5);
      await sendLineReply(params.deps, params.replyToken, chunks, "AGENT_ISSUES", lineLog("AGENT_ISSUES"));
      return;
    }

    if (cmd.type === "UNSUPPORTED_REQUESTS") {
      const rows = await logService.getOpenUnsupportedRequests(params.deps.supabase, { limit: 30 });
      if (rows.length === 0) {
        await sendLineReply(
          params.deps,
          params.replyToken,
          ["未対応リクエスト（open）はありません。"],
          "UNSUPPORTED_EMPTY",
          lineLog("UNSUPPORTED_EMPTY"),
        );
        return;
      }

      const lines: string[] = ["【RITS：未対応リクエスト（open）】", ""];
      for (const r of rows.slice(0, 20)) {
        lines.push(`- (${r.priority ?? "medium"}) ${r.agent_name ?? "?"}: ${r.request_text.slice(0, 300)}`);
        if (r.reason) lines.push(`  reason: ${r.reason.slice(0, 240)}`);
        if (r.suggested_feature) lines.push(`  suggested: ${r.suggested_feature.slice(0, 240)}`);
        lines.push("");
      }
      const chunks = chunkLineText(lines.join("\n"), 4500).slice(0, 5);
      await sendLineReply(params.deps, params.replyToken, chunks, "UNSUPPORTED_LIST", lineLog("UNSUPPORTED_LIST"));
      return;
    }

    if (cmd.type === "CURSOR_INSTRUCTION") {
      const audits = await logService.getRecentAudits(params.deps.supabase, { limit: 40 });
      const filtered = audits
        .filter((a) => (cmd.agent ? a.agent_name === cmd.agent : true))
        .filter(isHighRisk);

      const bundle =
        filtered.length > 0
          ? JSON.stringify(
              filtered.slice(0, 8).map((a) => ({
                agent: a.agent_name,
                issue_type: a.issue_type,
                risk: a.risk_level,
                summary: a.summary,
                improvement: a.improvement,
                cursor_instruction: a.cursor_instruction,
              })),
              null,
              2,
            )
          : JSON.stringify(
              audits.slice(0, 8).map((a) => ({
                agent: a.agent_name,
                issue_type: a.issue_type,
                risk: a.risk_level,
                summary: a.summary,
                improvement: a.improvement,
                cursor_instruction: a.cursor_instruction,
              })),
              null,
              2,
            );

      const system = buildRitsSystemPrompt();
      const user = [
        "以下はSupabaseのagent_auditsから抽出した高リスク優先の抜粋です。",
        "Cursorに貼れる修正指示文を1つにまとめてください。",
        "必須: 具体的な修正方針、想定ファイル候補、注意点、完了条件。",
        "",
        bundle,
      ].join("\n");

      const text = await generateText({
        client: params.deps.openai,
        model: params.deps.env.OPENAI_MODEL,
        system,
        user,
      });
      const chunks = chunkLineText(text, 4500).slice(0, 5);
      await sendLineReply(params.deps, params.replyToken, chunks, "CURSOR_INSTRUCTION", lineLog("CURSOR_INSTRUCTION"));
      return;
    }

    if (cmd.type === "HELP_CAPABILITIES") {
      await sendLineReply(
        params.deps,
        params.replyToken,
        [buildRitsCapabilitiesHelpReply()],
        "HELP_CAPABILITIES",
        lineLog("HELP_CAPABILITIES"),
      );
      return;
    }

    if (cmd.type === "GENERAL_QUESTION" || cmd.type === "UNKNOWN") {
      const system = buildRitsSystemPrompt();
      const ctx = await buildOwnerContext(params.deps);
      const user = [`オーナーからの入力:`, params.text, "", ctx].join("\n");
      const text = await generateText({
        client: params.deps.openai,
        model: params.deps.env.OPENAI_MODEL,
        system,
        user,
      });
      const chunks = chunkLineText(text, 4500).slice(0, 5);
      await sendLineReply(params.deps, params.replyToken, chunks, "GENERAL_OR_UNKNOWN", lineLog());
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("handleRitsLineText failed", {
      err: msg,
      stack: e instanceof Error ? e.stack : undefined,
      cmd,
    });

    try {
      await logService.createSystemError(params.deps.supabase, {
        source: "ritsService.handleRitsLineText",
        error_message: msg,
        stack_trace: e instanceof Error ? e.stack : undefined,
        severity: "high",
        metadata: { cmd },
      });
    } catch (logErr) {
      logger.error("createSystemError に失敗（ユーザー向け返信は続行）", {
        err: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }

    const lines = userFacingRitsErrorLines(e, params.deps.env.APP_BASE_URL);
    try {
      await sendLineReply(params.deps, params.replyToken, lines, "ERROR_FALLBACK", lineLog("ERROR_FALLBACK"));
    } catch (replyErr) {
      logger.error("ERROR_FALLBACK の sendLineReply が例外", { err: String(replyErr) });
      throw e;
    }
  }
}
