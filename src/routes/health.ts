import { Hono } from "hono";
import { loadEnv } from "../config/env.js";
import {
  describeSupabaseHttpUrl,
  getSupabaseEnvBlockReason,
  tryCreateSupabaseAdmin,
} from "../lib/supabase.js";
import { peekSupabaseJwtRole } from "../lib/supabaseJwt.js";
import { listMissingOrBrokenTables, probeRitsPublicTables } from "../lib/supabaseSchemaCheck.js";
import { logger } from "../lib/logger.js";

export const healthApp = new Hono();

const SCHEMA_HINT =
  "DBにRITS用テーブルがありません。Supabase Dashboard → SQL Editor で、リポジトリの src/db/schema.sql を全文コピーして一度だけ実行してください。";

healthApp.get("/health", async (c) => {
  const env = loadEnv();
  const supabaseBlock = getSupabaseEnvBlockReason(env);
  const supabase = supabaseBlock ? null : tryCreateSupabaseAdmin(env);
  const supabase_ok = supabase !== null;
  const supabase_hint = supabase_ok ? undefined : supabaseBlock ?? "env_looks_ok_but_createClient_failed_check_logs";

  const { host: supabase_url_host, projectRef: supabase_project_ref } = describeSupabaseHttpUrl(env.SUPABASE_URL);
  const supabase_jwt_role = peekSupabaseJwtRole(env.SUPABASE_SERVICE_ROLE_KEY);

  let supabase_schema_ok: boolean | undefined;
  let supabase_schema_hint: string | undefined;
  let supabase_missing_tables: string[] | undefined;
  let supabase_table_probes:
    | Record<string, { ok: boolean; code?: string; message?: string }>
    | undefined;

  if (supabase) {
    const { allOk, probes } = await probeRitsPublicTables(supabase);
    supabase_table_probes = Object.fromEntries(
      Object.entries(probes).map(([k, v]) => [
        k,
        v.ok ? { ok: true } : { ok: false, code: v.code, message: v.message },
      ]),
    );
    const missing = listMissingOrBrokenTables(probes);
    supabase_missing_tables = missing.length > 0 ? [...missing] : [];
    supabase_schema_ok = allOk;
    if (!allOk) {
      supabase_schema_hint = SCHEMA_HINT;
      logger.warn("/health: RITS 必須テーブルの一部にアクセスできません", {
        supabase_project_ref,
        supabase_url_host,
        missing,
      });
    }
  }

  return c.json({
    ok: true,
    service: "RITS",
    timestamp: new Date().toISOString(),
    supabase_ok,
    ...(supabase_ok ? {} : { supabase_hint }),
    supabase_url_host: supabase_url_host || undefined,
    supabase_project_ref: supabase_project_ref ?? undefined,
    supabase_jwt_role,
    ...(supabase_ok && supabase_schema_ok !== undefined
      ? {
          supabase_schema_ok,
          ...(supabase_schema_ok ? {} : { supabase_schema_hint }),
          supabase_missing_tables,
          supabase_table_probes,
        }
      : {}),
  });
});
