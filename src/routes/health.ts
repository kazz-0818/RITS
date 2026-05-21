import { Hono } from "hono";
import { loadEnv } from "../config/env.js";
import {
  describeSupabaseHttpUrl,
  getSupabaseEnvBlockReason,
  tryCreateSupabaseAdmin,
} from "../lib/supabase.js";
import { peekSupabaseJwtRole } from "../lib/supabaseJwt.js";
import {
  listMissingOrBrokenTables,
  probeRitsPublicTables,
  RITS_OPTIONAL_TABLES,
  RITS_REQUIRED_TABLES,
} from "../lib/supabaseSchemaCheck.js";
import { logger } from "../lib/logger.js";

export const healthApp = new Hono();

const SCHEMA_HINT =
  "DBにRITS用テーブルがありません。Supabase Dashboard → SQL Editor で、rits_schema_migrations/ の 001〜004 を順に実行してください（README 参照）。";

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

  const { allOk, optionalOk, probes } = await probeRitsPublicTables(supabase);
  const supabase_table_probes = Object.fromEntries(
    Object.entries(probes).map(([k, v]) => [
      k,
      v.ok ? { ok: true } : { ok: false, code: v.code, message: v.message },
    ]),
  );
  const supabase_missing_tables = listMissingOrBrokenTables(probes, RITS_REQUIRED_TABLES);
  const supabase_optional_missing_tables = listMissingOrBrokenTables(probes, RITS_OPTIONAL_TABLES);

  if (!allOk) {
    logger.warn("/health/supabase-tables: 必須テーブルにアクセスできません", {
      supabase_project_ref,
      missing: supabase_missing_tables,
    });
  }
  if (!optionalOk) {
    logger.warn("/health/supabase-tables: 任意テーブル未適用", {
      missing: supabase_optional_missing_tables,
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
    supabase_optional_schema_ok: optionalOk,
    ...(allOk ? {} : { supabase_schema_hint: SCHEMA_HINT }),
    ...(optionalOk
      ? {}
      : {
          supabase_optional_schema_hint:
            "rits_schema_migrations/017_llm_usage_events.sql を Supabase SQL Editor で実行してください。",
        }),
    supabase_missing_tables,
    ...(supabase_optional_missing_tables.length > 0
      ? { supabase_optional_missing_tables }
      : {}),
    supabase_table_probes,
  });
});

/**
 * Render healthCheckPath 用。外部 DB へは触れず即 200（デプロイの port scan / HTTP probe 向け）。
 * Supabase 実接続・全テーブル診断は GET /health/supabase-tables
 */
healthApp.get("/health", (c) => {
  const env = loadEnv();
  const supabaseBlock = getSupabaseEnvBlockReason(env);
  const supabase_ok = supabaseBlock === null && tryCreateSupabaseAdmin(env) !== null;
  const supabase_hint = supabase_ok ? undefined : supabaseBlock ?? "env_looks_ok_but_createClient_failed_check_logs";

  const { host: supabase_url_host, projectRef: supabase_project_ref } = describeSupabaseHttpUrl(env.SUPABASE_URL);
  const supabase_jwt_role = peekSupabaseJwtRole(env.SUPABASE_SERVICE_ROLE_KEY);

  return c.json({
    ok: true,
    service: "RITS",
    timestamp: new Date().toISOString(),
    port: env.PORT,
    node_env: env.NODE_ENV,
    supabase_ok,
    ...(supabase_ok ? {} : { supabase_hint }),
    supabase_url_host: supabase_url_host || undefined,
    supabase_project_ref: supabase_project_ref ?? undefined,
    supabase_jwt_role,
    supabase_tables_probe_url: "/health/supabase-tables",
  });
});
