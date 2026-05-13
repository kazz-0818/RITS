import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { AgentAuditRow } from "../types/audit.js";
import type { Env } from "../config/env.js";
import { getJstDateString } from "../lib/date.js";
import { chunkLineText, replyMessage } from "../lib/line.js";
import { generateText } from "../lib/openai.js";
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
}): Promise<void> {
  const cmd = classifyLineCommand(params.text);

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
      const body = row ? reportService.formatDailyReportForLine(row) : "日次レポートの生成に失敗しました。";
      const chunks = chunkLineText(body, 4500).slice(0, 5);
      await replyMessage({
        channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: params.replyToken,
        texts: chunks,
      });
      return;
    }

    if (cmd.type === "AGENT_ISSUES") {
      const agent = cmd.agent ?? "SERA";
      const audits = await logService.getAuditsByAgent(params.deps.supabase, { agent_name: agent, limit: 12 });
      const msg = formatAuditsForLine(agent, audits);
      const chunks = chunkLineText(msg, 4500).slice(0, 5);
      await replyMessage({
        channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: params.replyToken,
        texts: chunks,
      });
      return;
    }

    if (cmd.type === "UNSUPPORTED_REQUESTS") {
      const rows = await logService.getOpenUnsupportedRequests(params.deps.supabase, { limit: 30 });
      if (rows.length === 0) {
        await replyMessage({
          channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
          replyToken: params.replyToken,
          texts: ["未対応リクエスト（open）はありません。"],
        });
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
      await replyMessage({
        channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: params.replyToken,
        texts: chunks,
      });
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
      await replyMessage({
        channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: params.replyToken,
        texts: chunks,
      });
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
      await replyMessage({
        channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: params.replyToken,
        texts: chunks,
      });
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("handleRitsLineText failed", { err: msg });
    await logService.createSystemError(params.deps.supabase, {
      source: "ritsService.handleRitsLineText",
      error_message: msg,
      stack_trace: e instanceof Error ? e.stack : undefined,
      severity: "high",
      metadata: { cmd },
    });

    await replyMessage({
      channelAccessToken: params.deps.env.LINE_CHANNEL_ACCESS_TOKEN,
      replyToken: params.replyToken,
      texts: [
        "RITS: 処理中にエラーが発生しました。system_errorsを確認し、Supabase接続と環境変数を検証してください。",
      ],
    });
  }
}
