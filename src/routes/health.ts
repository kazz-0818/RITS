import { Hono } from "hono";
import { loadEnv } from "../config/env.js";
import { getSupabaseEnvBlockReason, tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

export const healthApp = new Hono();

/** クライアント作成は成功しているが、必須テーブルが無いときに返す短いヒント（秘密は含めない） */
const SCHEMA_HINT =
  "DBにRITS用テーブルがありません。Supabase Dashboard → SQL Editor で、リポジトリの src/db/schema.sql を全文コピーして一度だけ実行してください。";

healthApp.get("/health", async (c) => {
  const env = loadEnv();
  const supabaseBlock = getSupabaseEnvBlockReason(env);
  const supabase = supabaseBlock ? null : tryCreateSupabaseAdmin(env);
  const supabase_ok = supabase !== null;
  const supabase_hint = supabase_ok ? undefined : supabaseBlock ?? "env_looks_ok_but_createClient_failed_check_logs";

  let supabase_schema_ok: boolean | undefined;
  let supabase_schema_hint: string | undefined;

  if (supabase) {
    const { error } = await supabase.from("agent_profiles").select("agent_name").limit(1);
    if (error) {
      supabase_schema_ok = false;
      supabase_schema_hint = SCHEMA_HINT;
      logger.warn("/health: agent_profiles 参照失敗（未マイグレーションの可能性）", {
        code: error.code,
        message: error.message,
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
    ...(supabase_ok && supabase_schema_ok !== undefined
      ? { supabase_schema_ok, ...(supabase_schema_ok ? {} : { supabase_schema_hint }) }
      : {}),
  });
});
