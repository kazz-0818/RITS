import type { SupabaseClient } from "@supabase/supabase-js";

/** 001–005 相当（デプロイ・/health 必須） */
export const RITS_REQUIRED_TABLES = [
  "agent_profiles",
  "agent_logs",
  "agent_audits",
  "unsupported_requests",
  "system_errors",
  "daily_reports",
] as const;

/** 017 以降（未適用でも起動・デプロイは継続） */
export const RITS_OPTIONAL_TABLES = ["llm_usage_events"] as const;

export const RITS_PUBLIC_TABLES = [
  ...RITS_REQUIRED_TABLES,
  ...RITS_OPTIONAL_TABLES,
] as const;

export type RitsTableName = (typeof RITS_PUBLIC_TABLES)[number];
export type RitsRequiredTableName = (typeof RITS_REQUIRED_TABLES)[number];
export type RitsOptionalTableName = (typeof RITS_OPTIONAL_TABLES)[number];

export type TableProbe = { ok: true } | { ok: false; code: string; message: string };

/**
 * 各テーブルに head クエリを投げ、存在・参照可否を検査する
 */
export async function probeRitsPublicTables(
  supabase: SupabaseClient,
): Promise<{
  allOk: boolean;
  optionalOk: boolean;
  probes: Record<RitsTableName, TableProbe>;
}> {
  const probes = {} as Record<RitsTableName, TableProbe>;

  await Promise.all(
    RITS_PUBLIC_TABLES.map(async (name) => {
      // head:true だけだと PostgREST のスキーマキャッシュ未反映時に 204 で誤って ok になることがある
      const { error } = await supabase.from(name).select("id").limit(1);
      if (error) {
        probes[name] = {
          ok: false,
          code: error.code ?? "unknown",
          message: (error.message ?? "").slice(0, 240),
        };
      } else {
        probes[name] = { ok: true };
      }
    }),
  );

  const requiredOk = RITS_REQUIRED_TABLES.every((n) => probes[n]?.ok === true);
  const optionalOk = RITS_OPTIONAL_TABLES.every((n) => probes[n]?.ok === true);
  return { allOk: requiredOk, optionalOk, probes };
}

export function listMissingOrBrokenTables(
  probes: Record<RitsTableName, TableProbe>,
  tables: readonly RitsTableName[] = RITS_PUBLIC_TABLES,
): RitsTableName[] {
  return tables.filter((n) => !probes[n]?.ok);
}
