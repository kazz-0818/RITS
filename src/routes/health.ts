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

/** 6 テーブルまとめて診断（手動・監視用。Render の healthCheckPath には使わない） */
healthApp.get("/health/supabase-tables", async (c) => {
  const env = loadEnv();
  const supabaseBlock = getSupabaseEnvBlockReason(env);
  const supabase = supabaseBlock ? null : tryCreateSupabaseAdmin(env);
  if (!supabase) {
    return c.json(
      {
        ok: false,
        service: "RITS",
        timestamp: new Date().toISOString(),
        supabase_ok: false,
        supabase_hint: supabaseBlock ?? "createClient_returned_null",
      },
      503,
    );
  }

  const { host: supabase_url_host, projectRef: supabase_project_ref } = describeSupabaseHttpUrl(env.SUPABASE_URL);
  const supabase_jwt_role = peekSupabaseJwtRole(env.SUPABASE_SERVICE_ROLE_KEY);

  const { allOk, probes } = await probeRitsPublicTables(supabase);
  const supabase_table_probes = Object.fromEntries(
    Object.entries(probes).map(([k, v]) => [
      k,
      v.ok ? { ok: true } : { ok: false, code: v.code, message: v.message },
    ]),
  );
  const missing = listMissingOrBrokenTables(probes);
  const supabase_missing_tables = missing.length > 0 ? [...missing] : [];

  if (!allOk) {
    logger.warn("/health/supabase-tables: 一部テーブルにアクセスできません", {
      supabase_project_ref,
      missing: supabase_missing_tables,
    });
  }

  return c.json({
    ok: allOk,
    service: "RITS",
    timestamp: new Date().toISOString(),
    supabase_ok: true,
    supabase_url_host: supabase_url_host || undefined,
    supabase_project_ref: supabase_project_ref ?? undefined,
    supabase_jwt_role,
    supabase_schema_ok: allOk,
    ...(allOk ? {} : { supabase_schema_hint: SCHEMA_HINT }),
    supabase_missing_tables,
    supabase_table_probes,
  });
});

/** Render の healthCheck は数秒で失敗するため、既定は 1 クエリのみ（全テーブルは /health/supabase-tables） */
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

  if (supabase) {
    const { error } = await supabase.from("agent_profiles").select("agent_name").limit(1);
    if (error) {
      supabase_schema_ok = false;
      supabase_schema_hint = SCHEMA_HINT;
      logger.warn("/health: agent_profiles 参照失敗", {
        code: error.code,
        message: error.message,
        supabase_project_ref,
      });
    } else {
      supabase_schema_ok = true;
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
      ? { supabase_schema_ok, ...(supabase_schema_ok ? {} : { supabase_schema_hint }) }
      : {}),
    supabase_tables_probe_url: "/health/supabase-tables",
  });
});
