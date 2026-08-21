import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentLogRow } from "../types/agent.js";
import type { AgentAuditRow, DailyReportRow } from "../types/audit.js";
import type { LlmUsageDailySummary } from "../types/llmUsage.js";
import * as llmUsageService from "../services/llmUsageService.js";
import * as logService from "../services/logService.js";
import { formatAgentLogKindSuffix, splitAgentLogsByKind } from "./agentLogStats.js";
import { formatAuxiliaryOpsSection, loadAuxiliaryOpsCounts, type AuxiliaryOpsCounts } from "./auxiliaryOpsCounts.js";

const AGENTS = ["NEAR", "SERA", "IRIE", "LRAM"] as const;

export type DailyReportActivity = {
  reportDate: string;
  sinceIso: string;
  logsByAgent: Record<string, AgentLogRow[]>;
  audits: AgentAuditRow[];
  llm: LlmUsageDailySummary | null;
  auxiliaryOps: AuxiliaryOpsCounts;
};

function countLogs(logsByAgent: Record<string, AgentLogRow[]>, agent: string): number {
  return (logsByAgent[agent] ?? []).length;
}

function logsForAgent(logsByAgent: Record<string, AgentLogRow[]>, agent: string): AgentLogRow[] {
  return logsByAgent[agent] ?? [];
}

function formatGroupObserveSection(activity: DailyReportActivity): string {
  const lines: string[] = ["【24h グループ傍受（ボット未応答の発言）】"];
  let totalObserve = 0;
  for (const agent of AGENTS) {
    const split = splitAgentLogsByKind(logsForAgent(activity.logsByAgent, agent));
    totalObserve += split.groupObserve;
    if (split.groupObserve > 0) {
      lines.push(`・${agent}  ${split.groupObserve}件`);
    }
  }
  if (totalObserve === 0) {
    lines.push("・記録なし（各部署の VERIORA_RITS_* とグループ LINE が必要）");
  } else {
    lines.push(`・合計 ${totalObserve}件（監査LLM対象外・コンテキスト把握用）`);
  }
  return lines.join("\n");
}

function formatActivityTable(activity: DailyReportActivity): string {
  const lines: string[] = ["【24h 活動（事実）】"];
  for (const agent of AGENTS) {
    const logs = logsForAgent(activity.logsByAgent, agent);
    const split = splitAgentLogsByKind(logs);
    const llm = activity.llm?.by_agent.find((a) => a.agent_name === agent);
    const tok = llm?.total_tokens ?? 0;
    const req = llm?.request_count ?? 0;
    lines.push(
      `・${agent}  会話ログ ${formatAgentLogKindSuffix(split)}  LLM ${req}回 ${tok > 0 ? `${tok.toLocaleString("ja-JP")} tok` : "—"}`
    );
  }
  const auditN = activity.audits.length;
  lines.push(`・監査イベント ${auditN}件`);
  const ritsLogs = activity.logsByAgent["RITS"] ?? [];
  if (ritsLogs.length > 0) {
    const ritsSplit = splitAgentLogsByKind(ritsLogs);
    lines.push(`・RITS（人事LINE） ${formatAgentLogKindSuffix(ritsSplit)}`);
  }
  return lines.join("\n");
}

function stripMarkdownForLine(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^[-*]\s+/gm, "・")
    .replace(/^\d+\.\s+/gm, (m) => m)
    .trim();
}

function truncateBlock(text: string, max: number): string {
  const t = stripMarkdownForLine(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function splitPriorityIssues(raw: string): { numbered: string[]; rest: string } {
  const t = stripMarkdownForLine(raw);
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    if (/^(\d+[.)、]|・)\s*/.test(line) || /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(line)) {
      numbered.push(line.replace(/^(\d+[.)、]|・)\s*/, "").slice(0, 120));
    } else {
      rest.push(line);
    }
  }
  return { numbered: numbered.slice(0, 8), rest: rest.join(" ") };
}

export function formatDailyReportForLine(
  row: DailyReportRow,
  activity: DailyReportActivity
): string {
  const parts: string[] = [];
  const date = row.report_date ?? activity.reportDate;

  parts.push("━━━━━━━━━━━━━━━━");
  parts.push(`RITS 日次監査  ${date}`);
  parts.push("━━━━━━━━━━━━━━━━");
  parts.push("");
  parts.push(formatActivityTable(activity));
  parts.push("");
  parts.push(formatAuxiliaryOpsSection(activity.auxiliaryOps));
  parts.push("");
  parts.push(formatGroupObserveSection(activity));
  parts.push("");
  parts.push(`総合スコア: ${row.total_score ?? "—"} / 100`);
  parts.push("");

  parts.push("■ 総評");
  parts.push(truncateBlock(row.summary ?? "（なし）", 500));
  parts.push("");

  const deptBlocks: Array<{ title: string; body: string | null }> = [
    { title: "NEAR", body: row.near_summary },
    { title: "SERA", body: row.sera_summary },
    { title: "IRIE", body: row.irie_summary },
  ];

  for (const { title, body } of deptBlocks) {
    parts.push(`■ ${title}`);
    parts.push(truncateBlock(body ?? "（なし）", 280));
    parts.push("");
  }

  const lramSummary = (row.lram_summary ?? "").trim();
  const lramLogs = countLogs(activity.logsByAgent, "LRAM");
  if (lramSummary) {
    parts.push("■ LRAM");
    parts.push(truncateBlock(lramSummary, 280));
    parts.push("");
  } else if (lramLogs > 0 || activity.llm?.by_agent.some((a) => a.agent_name === "LRAM")) {
    parts.push("■ LRAM");
    parts.push(`会話ログ ${lramLogs}件（migration 025 適用で総評が表示されます）`);
    parts.push("");
  }

  parts.push("■ 優先改善");
  const pri = splitPriorityIssues(row.priority_issues ?? "");
  if (pri.numbered.length === 0 && !pri.rest) {
    parts.push("（特になし）");
  } else {
    pri.numbered.forEach((item, i) => {
      parts.push(`${i + 1}. ${item}`);
    });
    if (pri.rest) parts.push(truncateBlock(pri.rest, 300));
  }
  parts.push("");

  if (activity.llm && activity.llm.request_count > 0) {
    parts.push(llmUsageService.formatLlmUsageForLine(activity.llm));
  } else {
    parts.push("■ LLM 使用量");
    parts.push(
      "記録なし（各部署が POST /admin/usage に送ると集計。未着時は Render 429/スリープも確認）",
    );
  }
  parts.push("");

  parts.push("組織整合性の詳細: RITS/docs/veriora-consistency-audit.md");
  parts.push("（日次LINEには要約のみ。再監査は手動または別途）");
  parts.push("");
  parts.push("━━━━━━━━━━━━━━━━");

  return parts.join("\n");
}

export async function loadDailyReportActivity(
  supabase: SupabaseClient,
  params: { sinceIso: string; reportDate: string }
): Promise<DailyReportActivity> {
  const logsByAgent = await logService.getAgentLogsSinceForAgents(supabase, {
    sinceIso: params.sinceIso,
    agentNames: [...AGENTS, "RITS"],
    limitPerAgent: 120,
  });
  const audits = (
    await logService.getAuditsSince(supabase, { sinceIso: params.sinceIso, limit: 200 })
  ).filter((a) => (AGENTS as readonly string[]).includes(a.agent_name));

  let llm: LlmUsageDailySummary | null = null;
  try {
    llm = await llmUsageService.getLlmUsageDailySummary(supabase, params.reportDate);
  } catch {
    llm = null;
  }

  const auxiliaryOps = await loadAuxiliaryOpsCounts(supabase, params.sinceIso);

  return {
    reportDate: params.reportDate,
    sinceIso: params.sinceIso,
    logsByAgent,
    audits,
    llm,
    auxiliaryOps,
  };
}
