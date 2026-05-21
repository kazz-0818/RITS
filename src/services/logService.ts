import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AgentLogRowSchema,
  type AgentLogRow,
  type CreateAgentLogInput,
} from "../types/agent.js";
import {
  AgentAuditRowSchema,
  DailyReportRowSchema,
  type AgentAuditRow,
  type DailyReportRow,
} from "../types/audit.js";

function mapAgentLog(row: unknown): AgentLogRow | null {
  const p = AgentLogRowSchema.safeParse(row);
  return p.success ? p.data : null;
}

function mapAudit(row: unknown): AgentAuditRow | null {
  const p = AgentAuditRowSchema.safeParse(row);
  return p.success ? p.data : null;
}

function mapDaily(row: unknown): DailyReportRow | null {
  const p = DailyReportRowSchema.safeParse(row);
  return p.success ? p.data : null;
}

export async function createAgentLog(
  supabase: SupabaseClient,
  input: CreateAgentLogInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("agent_logs")
    .insert({
      agent_name: input.agent_name,
      user_message: input.user_message ?? null,
      agent_reply: input.agent_reply ?? null,
      intent: input.intent ?? null,
      confidence: input.confidence ?? null,
      source: input.source ?? "line",
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) throw new Error(`createAgentLog failed: ${error.message}`);
  if (!data?.id) throw new Error("createAgentLog failed: missing id");
  // TODO(Phase 3+): VERIORA_CORE_DUAL_WRITE + DATABASE_URL 時に veriora.messages へ best-effort デュアル書き込み
  return { id: data.id as string };
}

export async function getRecentAgentLogs(
  supabase: SupabaseClient,
  params: { sinceIso: string; limit?: number },
): Promise<AgentLogRow[]> {
  const limit = params.limit ?? 200;
  const { data, error } = await supabase
    .from("agent_logs")
    .select("*")
    .gte("created_at", params.sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getRecentAgentLogs failed: ${error.message}`);
  const rows = (data ?? []).map(mapAgentLog).filter((r): r is AgentLogRow => r !== null);
  return rows;
}

export async function getAgentLogsByName(
  supabase: SupabaseClient,
  params: { agent_name: string; limit?: number },
): Promise<AgentLogRow[]> {
  const limit = params.limit ?? 50;
  const { data, error } = await supabase
    .from("agent_logs")
    .select("*")
    .eq("agent_name", params.agent_name)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getAgentLogsByName failed: ${error.message}`);
  return (data ?? []).map(mapAgentLog).filter((r): r is AgentLogRow => r !== null);
}

export async function createAudit(
  supabase: SupabaseClient,
  input: {
    agent_name: string;
    target_log_id?: string | null;
    score: number;
    grade: string;
    issue_type: string;
    risk_level: string;
    summary: string;
    evidence: string;
    improvement: string;
    cursor_instruction: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("agent_audits")
    .insert({
      agent_name: input.agent_name,
      target_log_id: input.target_log_id ?? null,
      score: input.score,
      grade: input.grade,
      issue_type: input.issue_type,
      risk_level: input.risk_level,
      summary: input.summary,
      evidence: input.evidence,
      improvement: input.improvement,
      cursor_instruction: input.cursor_instruction,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) throw new Error(`createAudit failed: ${error.message}`);
  if (!data?.id) throw new Error("createAudit failed: missing id");
  return { id: data.id as string };
}

export async function getRecentAudits(
  supabase: SupabaseClient,
  params: { limit?: number },
): Promise<AgentAuditRow[]> {
  const limit = params.limit ?? 50;
  const { data, error } = await supabase
    .from("agent_audits")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getRecentAudits failed: ${error.message}`);
  return (data ?? []).map(mapAudit).filter((r): r is AgentAuditRow => r !== null);
}

export async function getAuditsSince(
  supabase: SupabaseClient,
  params: { sinceIso: string; limit?: number },
): Promise<AgentAuditRow[]> {
  const limit = params.limit ?? 500;
  const { data, error } = await supabase
    .from("agent_audits")
    .select("*")
    .gte("created_at", params.sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getAuditsSince failed: ${error.message}`);
  return (data ?? []).map(mapAudit).filter((r): r is AgentAuditRow => r !== null);
}

export async function getAgentLogsSinceForAgents(
  supabase: SupabaseClient,
  params: { sinceIso: string; agentNames: string[]; limitPerAgent?: number },
): Promise<Record<string, AgentLogRow[]>> {
  const limitPerAgent = params.limitPerAgent ?? 80;
  const out: Record<string, AgentLogRow[]> = {};
  for (const name of params.agentNames) {
    const { data, error } = await supabase
      .from("agent_logs")
      .select("*")
      .eq("agent_name", name)
      .gte("created_at", params.sinceIso)
      .order("created_at", { ascending: false })
      .limit(limitPerAgent);
    if (error) throw new Error(`getAgentLogsSinceForAgents failed: ${error.message}`);
    out[name] = (data ?? []).map(mapAgentLog).filter((r): r is AgentLogRow => r !== null);
  }
  return out;
}

export async function getAuditsByAgent(
  supabase: SupabaseClient,
  params: { agent_name: string; limit?: number },
): Promise<AgentAuditRow[]> {
  const limit = params.limit ?? 20;
  const { data, error } = await supabase
    .from("agent_audits")
    .select("*")
    .eq("agent_name", params.agent_name)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getAuditsByAgent failed: ${error.message}`);
  return (data ?? []).map(mapAudit).filter((r): r is AgentAuditRow => r !== null);
}

export async function createSystemError(
  supabase: SupabaseClient,
  input: {
    source?: string | null;
    error_message: string;
    stack_trace?: string | null;
    severity?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("system_errors")
    .insert({
      source: input.source ?? null,
      error_message: input.error_message,
      stack_trace: input.stack_trace ?? null,
      severity: input.severity ?? "medium",
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) {
    // 最後の砦: DBに書けない場合は例外のまま
    throw new Error(`createSystemError failed: ${error.message}`);
  }
  if (!data?.id) throw new Error("createSystemError failed: missing id");
  return { id: data.id as string };
}

export type UnsupportedRequestRow = {
  id: string;
  agent_name: string | null;
  request_text: string;
  reason: string | null;
  suggested_feature: string | null;
  priority: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};

export async function getOpenUnsupportedRequests(
  supabase: SupabaseClient,
  params: { limit?: number },
): Promise<UnsupportedRequestRow[]> {
  const limit = params.limit ?? 50;
  const { data, error } = await supabase
    .from("unsupported_requests")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getOpenUnsupportedRequests failed: ${error.message}`);

  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const rows = (data ?? []) as UnsupportedRequestRow[];
  rows.sort((a, b) => {
    const pa = priorityRank[a.priority ?? "medium"] ?? 2;
    const pb = priorityRank[b.priority ?? "medium"] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return rows;
}

export async function createDailyReport(
  supabase: SupabaseClient,
  input: {
    report_date: string; // YYYY-MM-DD
    summary: string;
    near_summary: string;
    sera_summary: string;
    lira_summary: string;
    total_score: number;
    priority_issues: string;
    cursor_instruction: string;
  },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("daily_reports")
    .upsert(
      {
        report_date: input.report_date,
        summary: input.summary,
        near_summary: input.near_summary,
        sera_summary: input.sera_summary,
        lira_summary: input.lira_summary,
        total_score: input.total_score,
        priority_issues: input.priority_issues,
        cursor_instruction: input.cursor_instruction,
      },
      { onConflict: "report_date" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`createDailyReport failed: ${error.message}`);
  if (!data?.id) throw new Error("createDailyReport failed: missing id");
  return { id: data.id as string };
}

export async function getDailyReportByDate(
  supabase: SupabaseClient,
  reportDate: string,
): Promise<DailyReportRow | null> {
  const { data, error } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("report_date", reportDate)
    .maybeSingle();

  if (error) throw new Error(`getDailyReportByDate failed: ${error.message}`);
  return mapDaily(data);
}

/** 005 未適用時は false（push 自体は成功させる） */
export async function markDailyReportOwnerLinePushed(
  supabase: SupabaseClient,
  reportDate: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("daily_reports")
    .update({ owner_line_pushed_at: new Date().toISOString() })
    .eq("report_date", reportDate);

  if (!error) return true;
  const msg = error.message ?? "";
  if (msg.includes("owner_line_pushed_at") || error.code === "PGRST204") {
    return false;
  }
  throw new Error(`markDailyReportOwnerLinePushed failed: ${msg}`);
}

export async function getAgentProfileByName(
  supabase: SupabaseClient,
  agentName: string,
): Promise<{
  agent_name: string;
  role: string;
  allowed_scope: string | null;
  forbidden_scope: string | null;
  evaluation_rules: string | null;
} | null> {
  const { data, error } = await supabase
    .from("agent_profiles")
    .select("agent_name, role, allowed_scope, forbidden_scope, evaluation_rules")
    .eq("agent_name", agentName)
    .maybeSingle();

  if (error) throw new Error(`getAgentProfileByName failed: ${error.message}`);
  if (!data) return null;
  return data as {
    agent_name: string;
    role: string;
    allowed_scope: string | null;
    forbidden_scope: string | null;
    evaluation_rules: string | null;
  };
}
