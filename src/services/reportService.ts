import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { AgentAuditRow } from "../types/audit.js";
import type { DailyReportRow } from "../types/audit.js";
import { getUtcIso24HoursAgo, getJstDateString } from "../lib/date.js";
import { generateJson } from "../lib/openai.js";
import {
  formatDailyReportForLine as formatLine,
  loadDailyReportActivity,
} from "../lib/dailyReportLineFormat.js";
import { DailyReportAiSchema, buildDailyReportSystemPrompt, buildDailyReportUserPrompt } from "../prompts/reportPrompt.js";
import * as logService from "./logService.js";
import * as llmUsageService from "./llmUsageService.js";
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
        `   summary=${(a.summary ?? "").slice(0, 180)}`,
      ].join("\n");
    })
    .join("\n");
}

function buildDeterministicBundle(params: {
  sinceIso: string;
  logsByAgent: Awaited<ReturnType<typeof logService.getAgentLogsSinceForAgents>>;
  audits: AgentAuditRow[];
  llmSection: string;
}): string {
  const lines: string[] = [];
  lines.push(`window_start_utc: ${params.sinceIso}`);
  lines.push(`targets: ${TARGET_AGENTS.join(", ")}`);
  lines.push("");
  lines.push("IMPORTANT: logs_count_24h and LLM_usage are authoritative facts. Do not claim zero activity if counts > 0.");
  lines.push("");

  for (const agent of TARGET_AGENTS) {
    const logs = params.logsByAgent[agent] ?? [];
    lines.push(`## ${agent}`);
    lines.push(`logs_count_24h: ${logs.length}`);
    if (logs.length > 0) {
      const last = logs[0];
      lines.push(`latest_user_snippet: ${(last.user_message ?? "").slice(0, 120)}`);
      lines.push(`latest_reply_snippet: ${(last.agent_reply ?? "").slice(0, 120)}`);
    }
    lines.push("audit_highlights:");
    lines.push(summarizeAudits(params.audits, agent, 4) || "(none)");
    lines.push("");
  }

  lines.push(params.llmSection);
  return lines.join("\n");
}

function fallbackDailyFromBundle(_bundle: string): {
  summary: string;
  near_summary: string;
  sera_summary: string;
  lira_summary: string;
  total_score: number;
  priority_issues: string;
  cursor_instruction: string;
} {
  return {
    summary: "日次レポートのJSON生成に失敗しました。活動サマリ（事実）を確認してください。",
    near_summary: "—",
    sera_summary: "—",
    lira_summary: "—",
    total_score: 50,
    priority_issues: "1) reportService の JSON 検証を確認\n2) 各部署の VERIORA_RITS_* と /admin/logs 転送を確認",
    cursor_instruction: "src/services/reportService.ts と src/prompts/reportPrompt.ts を確認",
  };
}

export async function generateAndStoreDailyReport(params: {
  supabase: SupabaseClient;
  openai: OpenAI;
  model: string;
  reportDate: string;
}): Promise<{ id: string }> {
  const sinceIso = getUtcIso24HoursAgo(new Date());
  const reportDate = params.reportDate;

  const logsByAgent = await logService.getAgentLogsSinceForAgents(params.supabase, {
    sinceIso,
    agentNames: [...TARGET_AGENTS],
    limitPerAgent: 60,
  });

  const audits = (await logService.getAuditsSince(params.supabase, { sinceIso, limit: 800 })).filter((a) =>
    (TARGET_AGENTS as readonly string[]).includes(a.agent_name),
  );

  let llmSection = "";
  try {
    const llmSummary = await llmUsageService.getLlmUsageDailySummary(params.supabase, reportDate);
    llmSection = llmUsageService.formatLlmUsageBundleSection(llmSummary);
  } catch {
    llmSection = "## LLM_usage_JST_day\nrequests: 0 (migration 017 or no VERIORA_RITS_* on agents)";
  }

  const bundle = buildDeterministicBundle({ sinceIso, logsByAgent, audits, llmSection });

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
      metadata: { report_date: reportDate, raw_snippet: gen.failure.raw?.slice(0, 4000) },
    });
  }

  const total = Math.min(100, Math.max(0, Math.round(payload.total_score)));

  return logService.createDailyReport(params.supabase, {
    report_date: reportDate,
    summary: payload.summary,
    near_summary: payload.near_summary,
    sera_summary: payload.sera_summary,
    lira_summary: payload.lira_summary,
    total_score: total,
    priority_issues: payload.priority_issues,
    cursor_instruction: payload.cursor_instruction,
  });
}

export async function formatDailyReportForLine(
  row: DailyReportRow,
  options?: { supabase?: SupabaseClient }
): Promise<string> {
  const reportDate = row.report_date ?? getJstDateString(new Date());
  const sinceIso = getUtcIso24HoursAgo(new Date());

  if (!options?.supabase) {
    return formatLine(row, {
      reportDate,
      sinceIso,
      logsByAgent: {},
      audits: [],
      llm: null,
    });
  }

  const activity = await loadDailyReportActivity(options.supabase, { sinceIso, reportDate });
  return formatLine(row, activity);
}
