import type { SupabaseClient } from "@supabase/supabase-js";

export type AuxiliaryOpsCounts = {
  lram_requests_24h: number;
};

/** 各部署の業務テーブル（agent_logs に未転送の活動の参考） */
export async function loadAuxiliaryOpsCounts(
  supabase: SupabaseClient,
  sinceIso: string,
): Promise<AuxiliaryOpsCounts> {
  let lram_requests_24h = 0;
  try {
    const { count, error } = await supabase
      .from("lram_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso);
    if (!error && count != null) lram_requests_24h = count;
  } catch {
    /* テーブル未作成時は 0 */
  }
  return { lram_requests_24h };
}

export function formatAuxiliaryOpsSection(ops: AuxiliaryOpsCounts): string {
  const lines: string[] = ["【24h 業務DB（参考・未転送あり）】"];
  if (ops.lram_requests_24h > 0) {
    lines.push(
      `・LRAM lram_requests ${ops.lram_requests_24h}件（Cron/自動。agent_logs に無い場合は VERIORA_RITS 転送または Cron ingest を確認）`,
    );
  } else {
    lines.push("・LRAM lram_requests 0件");
  }
  lines.push("（日次の会話ログ件数は agent_logs のみ。上記は突合参考）");
  return lines.join("\n");
}
