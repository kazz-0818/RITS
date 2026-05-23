import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmUsageDailySummary, LlmUsageEventRow, LlmUsageIngest } from "../types/llmUsage.js";
import { getJstDayRangeUtc } from "../lib/date.js";

const KNOWN_AGENTS = ["NEAR", "SERA", "IRIE", "LRAM", "RITS"] as const;

function normalizeAgentName(name: string): string {
  const u = name.trim().toUpperCase();
  if (u === "NEIA" || u === "NIA") return "NEAR";
  return u;
}

export async function ingestLlmUsage(
  supabase: SupabaseClient,
  input: LlmUsageIngest
): Promise<{ id: string }> {
  const prompt = input.prompt_tokens;
  const completion = input.completion_tokens;
  const total = input.total_tokens ?? prompt + completion;

  const { data, error } = await supabase
    .from("llm_usage_events")
    .insert({
      agent_name: normalizeAgentName(input.agent_name),
      model: input.model.trim(),
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      source: input.source.trim(),
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) throw new Error(`ingestLlmUsage failed: ${error.message}`);
  if (!data?.id) throw new Error("ingestLlmUsage failed: missing id");
  return { id: data.id as string };
}

export async function listLlmUsageEventsSince(
  supabase: SupabaseClient,
  params: { sinceIso: string; untilIso?: string; limit?: number }
): Promise<LlmUsageEventRow[]> {
  const limit = Math.min(params.limit ?? 5000, 10000);
  let q = supabase
    .from("llm_usage_events")
    .select(
      "id, agent_name, model, prompt_tokens, completion_tokens, total_tokens, source, metadata, created_at"
    )
    .gte("created_at", params.sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.untilIso) {
    q = q.lt("created_at", params.untilIso);
  }

  const { data, error } = await q;
  if (error) {
    if (error.code === "PGRST205" || error.message.includes("llm_usage_events")) {
      return [];
    }
    throw new Error(`listLlmUsageEventsSince failed: ${error.message}`);
  }

  return (data ?? []) as LlmUsageEventRow[];
}

export function aggregateLlmUsage(
  rows: LlmUsageEventRow[],
  reportDate: string,
  range: { sinceIso: string; untilIso: string }
): LlmUsageDailySummary {
  let prompt = 0;
  let completion = 0;
  let total = 0;

  const byAgent = new Map<
    string,
    { requests: number; prompt: number; completion: number; total: number; models: Map<string, number> }
  >();
  const byModel = new Map<string, { total: number; requests: number }>();

  for (const row of rows) {
    const agent = normalizeAgentName(row.agent_name);
    const pt = row.prompt_tokens ?? 0;
    const ct = row.completion_tokens ?? 0;
    const tt = row.total_tokens ?? pt + ct;
    prompt += pt;
    completion += ct;
    total += tt;

    let a = byAgent.get(agent);
    if (!a) {
      a = { requests: 0, prompt: 0, completion: 0, total: 0, models: new Map() };
      byAgent.set(agent, a);
    }
    a.requests += 1;
    a.prompt += pt;
    a.completion += ct;
    a.total += tt;
    a.models.set(row.model, (a.models.get(row.model) ?? 0) + tt);

    const m = row.model.trim() || "unknown";
    const mm = byModel.get(m) ?? { total: 0, requests: 0 };
    mm.total += tt;
    mm.requests += 1;
    byModel.set(m, mm);
  }

  const by_agent = [...byAgent.entries()]
    .map(([agent_name, v]) => {
      let top_model = "—";
      let topTok = 0;
      for (const [model, tok] of v.models) {
        if (tok > topTok) {
          topTok = tok;
          top_model = model;
        }
      }
      return {
        agent_name,
        request_count: v.requests,
        prompt_tokens: v.prompt,
        completion_tokens: v.completion,
        total_tokens: v.total,
        share_pct: total > 0 ? Math.round((v.total / total) * 1000) / 10 : 0,
        top_model,
      };
    })
    .sort((a, b) => b.total_tokens - a.total_tokens);

  const by_model = [...byModel.entries()]
    .map(([model, v]) => ({
      model,
      total_tokens: v.total,
      request_count: v.requests,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens);

  return {
    report_date: reportDate,
    since_iso: range.sinceIso,
    until_iso: range.untilIso,
    request_count: rows.length,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    by_agent,
    by_model,
  };
}

export async function getLlmUsageDailySummary(
  supabase: SupabaseClient,
  reportDate: string
): Promise<LlmUsageDailySummary> {
  const range = getJstDayRangeUtc(reportDate);
  const rows = await listLlmUsageEventsSince(supabase, {
    sinceIso: range.sinceIso,
    untilIso: range.untilIso,
  });
  return aggregateLlmUsage(rows, reportDate, range);
}

/** 日次 LINE 用テキスト（確定集計・AI 不要） */
export function formatLlmUsageForLine(summary: LlmUsageDailySummary): string {
  const lines: string[] = [];
  lines.push(`■ LLM 使用量（JST ${summary.report_date}）`);

  if (summary.request_count === 0) {
    lines.push("記録なし（各エージェントが POST /admin/usage で送るとここに集計されます）");
    lines.push(`対象エージェント例: ${KNOWN_AGENTS.join(" / ")}`);
    return lines.join("\n");
  }

  lines.push(
    `合計: ${summary.total_tokens.toLocaleString("ja-JP")} tokens（${summary.request_count} リクエスト）`
  );
  lines.push(
    `内訳: prompt ${summary.prompt_tokens.toLocaleString("ja-JP")} / completion ${summary.completion_tokens.toLocaleString("ja-JP")}`
  );
  lines.push("");
  lines.push("■ エージェント別シェア（トークン占有率）");
  for (const a of summary.by_agent) {
    lines.push(
      `${a.agent_name.padEnd(5)} ${String(a.share_pct).padStart(5)}%  ${a.total_tokens.toLocaleString("ja-JP")} tok  (${a.request_count} req)  ${a.top_model}`
    );
  }
  if (summary.by_model.length > 0) {
    lines.push("");
    lines.push("■ モデル別");
    for (const m of summary.by_model.slice(0, 8)) {
      lines.push(
        `- ${m.model}: ${m.total_tokens.toLocaleString("ja-JP")} tok (${m.request_count} req)`
      );
    }
  }
  return lines.join("\n");
}

export function formatLlmUsageBundleSection(summary: LlmUsageDailySummary): string {
  const lines: string[] = [];
  lines.push("## LLM_usage_JST_day");
  lines.push(`report_date: ${summary.report_date}`);
  lines.push(`requests: ${summary.request_count}`);
  lines.push(`total_tokens: ${summary.total_tokens}`);
  lines.push(`prompt_tokens: ${summary.prompt_tokens}`);
  lines.push(`completion_tokens: ${summary.completion_tokens}`);
  for (const a of summary.by_agent) {
    lines.push(
      `agent ${a.agent_name}: share=${a.share_pct}% tokens=${a.total_tokens} requests=${a.request_count} model=${a.top_model}`
    );
  }
  return lines.join("\n");
}
