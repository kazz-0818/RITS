import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { AgentLogRow } from "../types/agent.js";
import type { AgentAuditRow, DailyReportRow } from "../types/audit.js";
import { getUtcIso24HoursAgo } from "../lib/date.js";
import { generateJson } from "../lib/openai.js";
import { DailyReportAiSchema, buildDailyReportSystemPrompt, buildDailyReportUserPrompt } from "../prompts/reportPrompt.js";
import * as logService from "./logService.js";
import * as llmUsageService from "./llmUsageService.js";
import { getJstDateString } from "../lib/date.js";
import {
  formatOrganizationConsistencyForLine,
  loadOrganizationConsistencyBundleSection,
} from "./organizationConsistency.js";

const TARGET_AGENTS = ["NEAR", "SERA", "LIRA", "LRAM"] as const;

function riskRank(r: string | null): number {
  const x = (r ?? "low").toLowerCase();
  if (x === "critical") return 0;
  if (x === "high") return 1;
  if (x === "medium") return 2;
  return 3;
}

function summarizeAudits(audits: AgentAuditRow[], agent: string, max = 6): string {
  const rows = audits.filter((a) => a.agent_name === agent).sort((a, b) => {
    const rr = riskRank(a.risk_level) - riskRank(b.risk_level);
    if (rr !== 0) return rr;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return rows
    .slice(0, max)
    .map((a, i) => {
      return [
        `${i + 1}. score=${a.score ?? "?"} grade=${a.grade ?? "?"} risk=${a.risk_level ?? "?"}`,
        `   issue_type=${a.issue_type ?? "?"}`,
        `   summary=${(a.summary ?? "").slice(0, 220)}`,
      ].join("\n");
    })
    .join("\n");
}

function buildDeterministicBundle(params: {
  sinceIso: string;
  logsByAgent: Record<string, AgentLogRow[] | undefined>;
  audits: AgentAuditRow[];
}): string {
  const lines: string[] = [];
  lines.push(`window_start_utc: ${params.sinceIso}`);
  lines.push(`targets: ${TARGET_AGENTS.join(", ")}`);
  lines.push("");

  for (const agent of TARGET_AGENTS) {
    const logs = params.logsByAgent[agent] ?? [];
    lines.push(`## ${agent}`);
    lines.push(`logs_count_24h: ${logs.length}`);
    lines.push("audit_highlights:");
    lines.push(summarizeAudits(params.audits, agent, 8) || "(none)");
    lines.push("");
  }

  lines.push("## audits_overall");
  lines.push(`audits_count_24h: ${params.audits.length}`);
  const worst = [...params.audits].sort((a, b) => riskRank(a.risk_level) - riskRank(b.risk_level)).slice(0, 10);
  lines.push(
    worst
      .map(
        (a, i) =>
          `${i + 1}. [${a.agent_name}] risk=${a.risk_level} score=${a.score} ${(a.summary ?? "").slice(0, 160)}`,
      )
      .join("\n") || "(none)",
  );

  return lines.join("\n");
}

function fallbackDailyFromBundle(bundle: string): {
  summary: string;
  near_summary: string;
  sera_summary: string;
  lira_summary: string;
  total_score: number;
  priority_issues: string;
  cursor_instruction: string;
} {
  return {
    summary:
      "日次レポートのJSON生成に失敗したため、暫定の要約のみ返します。system_errorsを確認し、OpenAI出力形式を修正してください。\n\n" +
      bundle.slice(0, 1500),
    near_summary: "情報不足（自動生成失敗）",
    sera_summary: "情報不足（自動生成失敗）",
    lira_summary: "情報不足（自動生成失敗）",
    total_score: 50,
    priority_issues: "1) 日次レポート生成パイプラインのJSON検証失敗を修復\n2) 監査ログ投入とモデル出力の整合を確認",
    cursor_instruction:
      "`src/services/reportService.ts` と `src/prompts/reportPrompt.ts` を確認し、`DailyReportAiSchema` に一致するJSONのみを返すよう修正してください。",
  };
}

export async function generateAndStoreDailyReport(params: {
  supabase: SupabaseClient;
  openai: OpenAI;
  model: string;
  reportDate: string; // YYYY-MM-DD (JSTの暦日)
}): Promise<{ id: string }> {
  const sinceIso = getUtcIso24HoursAgo(new Date());

  const logsByAgent = await logService.getAgentLogsSinceForAgents(params.supabase, {
    sinceIso,
    agentNames: [...TARGET_AGENTS],
    limitPerAgent: 60,
  });

  const audits = (await logService.getAuditsSince(params.supabase, { sinceIso, limit: 800 })).filter((a) =>
    (TARGET_AGENTS as readonly string[]).includes(a.agent_name),
  );

  const bundleBase = buildDeterministicBundle({ sinceIso, logsByAgent, audits });
  const reportDate = params.reportDate;
  let llmSection = "";
  try {
    const llmSummary = await llmUsageService.getLlmUsageDailySummary(params.supabase, reportDate);
    llmSection = llmUsageService.formatLlmUsageBundleSection(llmSummary);
  } catch {
    llmSection = "## LLM_usage_JST_day\n(no data or migration 017 not applied)";
  }
  const orgSection = loadOrganizationConsistencyBundleSection();
  const bundle = [bundleBase, llmSection, orgSection].filter(Boolean).join("\n\n");

  const gen = await generateJson({
    client: params.openai,
    model: params.model,
    system: buildDailyReportSystemPrompt(),
    user: buildDailyReportUserPrompt({ bundle }),
    schema: DailyReportAiSchema,
  });

  const payload = gen.ok ? gen.data : fallbackDailyFromBundle(bundle);

  if (!gen.ok) {
    await logService.createSystemError(params.supabase, {
      source: "reportService.generateJson",
      error_message: `Daily report JSON validation failed (${gen.failure.kind}): ${gen.failure.message}`,
      stack_trace: gen.failure.zodError,
      severity: "high",
      metadata: { report_date: params.reportDate, raw_snippet: gen.failure.raw?.slice(0, 4000) },
    });
  }

  const total = Math.min(100, Math.max(0, Math.round(payload.total_score)));

  let priorityIssues = payload.priority_issues;
  const orgBlurb = loadOrganizationConsistencyBundleSection();
  if (orgBlurb) {
    const excerpt = orgBlurb.replace(/^## organization_consistency_audit[\s\S]*?\n\n/, "").slice(0, 700);
    priorityIssues = `[組織整合性監査（抜粋）]\n${excerpt}\n\n${priorityIssues}`;
  }

  return logService.createDailyReport(params.supabase, {
    report_date: params.reportDate,
    summary: payload.summary,
    near_summary: payload.near_summary,
    sera_summary: payload.sera_summary,
    lira_summary: payload.lira_summary,
    total_score: total,
    priority_issues: priorityIssues,
    cursor_instruction: payload.cursor_instruction,
  });
}

export async function formatDailyReportForLine(
  row: DailyReportRow,
  options?: { supabase?: import("@supabase/supabase-js").SupabaseClient }
): Promise<string> {
  const parts: string[] = [];
  parts.push("【RITS 日次監査】");
  parts.push("");
  parts.push("対象：NEAR / SERA / LIRA / LRAM");
  parts.push("");
  parts.push("■ 総評");
  parts.push(row.summary ?? "(summary empty)");
  parts.push("");
  parts.push("■ NEAR");
  parts.push(row.near_summary ?? "(empty)");
  parts.push("");
  parts.push("■ SERA");
  parts.push(row.sera_summary ?? "(empty)");
  parts.push("");
  parts.push("■ LIRA");
  parts.push(row.lira_summary ?? "(empty)");
  parts.push("");
  parts.push("■ 優先改善");
  parts.push(row.priority_issues ?? "(empty)");
  parts.push("");
  const orgLine = formatOrganizationConsistencyForLine();
  if (orgLine) {
    parts.push(orgLine);
    parts.push("");
  }
  parts.push(`total_score: ${row.total_score ?? "?"}`);
  parts.push("");

  if (options?.supabase) {
    try {
      const llm = await llmUsageService.getLlmUsageDailySummary(
        options.supabase,
        row.report_date ?? getJstDateString(new Date())
      );
      parts.push(llmUsageService.formatLlmUsageForLine(llm));
      parts.push("");
    } catch {
      parts.push("■ LLM 使用量");
      parts.push("（集計不可: migration 017_llm_usage_events を適用してください）");
      parts.push("");
    }
  }

  parts.push("必要であれば、Cursor向けの修正指示文を作成できます。");
  return parts.join("\n");
}
