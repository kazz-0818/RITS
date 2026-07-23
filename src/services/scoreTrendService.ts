import { tryGetPool } from "../db/client.js";
import { listDailyScoreTrends } from "./supabase/repositories/messageFeed.js";

const TREND_AGENTS = ["near", "sera", "irie", "lram"] as const;

/**
 * 部署別スコア推移（品質台帳の日次レビュー）。
 */
export async function formatScoreTrendForLine(days = 7): Promise<string> {
  const db = tryGetPool();
  if (!db) {
    return [
      "【RITS：スコア推移】",
      "",
      "DATABASE_URL が未設定のため品質台帳の推移を読めません。",
    ].join("\n");
  }

  const rows = await listDailyScoreTrends(db, {
    days,
    agentKeys: [...TREND_AGENTS],
  });

  if (rows.length === 0) {
    return [
      "【RITS：スコア推移】",
      "",
      `直近${days}日の quality reviews がありません。監査が品質台帳へ書込まれるとここに出ます。`,
    ].join("\n");
  }

  const byAgent = new Map<string, { date: string; score: number | null }[]>();
  for (const r of rows) {
    const key = (r.agent_code || r.agent_key).toUpperCase();
    const list = byAgent.get(key) ?? [];
    list.push({ date: r.review_date, score: r.score_overall });
    byAgent.set(key, list);
  }

  const lines: string[] = [`【RITS：スコア推移（直近${days}日）】`, ""];
  for (const agent of ["NEAR", "SERA", "IRIE", "LRAM"]) {
    const series = byAgent.get(agent) ?? [];
    if (series.length === 0) {
      lines.push(`${agent}: （データなし）`);
      continue;
    }
    const pts = series
      .map((s) => `${s.date.slice(5)}:${s.score ?? "?"}`)
      .join(" → ");
    const nums = series.map((s) => s.score).filter((n): n is number => n != null);
    const delta =
      nums.length >= 2 ? nums[nums.length - 1]! - nums[0]! : null;
    const deltaLabel =
      delta == null ? "" : delta > 0 ? `  (↑${delta})` : delta < 0 ? `  (↓${Math.abs(delta)})` : "  (→0)";
    lines.push(`${agent}: ${pts}${deltaLabel}`);
  }
  lines.push("");
  lines.push("出典: veliora.agent_quality_reviews");
  return lines.join("\n");
}
