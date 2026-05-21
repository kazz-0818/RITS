import type { SupabaseClient } from "@supabase/supabase-js";

/** rits_schema_migrations が作成する public テーブル（順不同） */
export const RITS_PUBLIC_TABLES = [
  "agent_profiles",
  "agent_logs",
  "agent_audits",
  "unsupported_requests",
  "system_errors",
  "daily_reports",
] as const;

export type RitsTableName = (typeof RITS_PUBLIC_TABLES)[number];

export type TableProbe = { ok: true } | { ok: false; code: string; message: string };

/**
 * 各テーブルに head クエリを投げ、存在・参照可否を検査する
 */
export async function probeRitsPublicTables(
  supabase: SupabaseClient,
): Promise<{ allOk: boolean; probes: Record<RitsTableName, TableProbe> }> {
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

  const allOk = RITS_PUBLIC_TABLES.every((n) => probes[n]?.ok === true);
  return { allOk, probes };
}

export function listMissingOrBrokenTables(probes: Record<RitsTableName, TableProbe>): RitsTableName[] {
  return RITS_PUBLIC_TABLES.filter((n) => !probes[n]?.ok);
}
