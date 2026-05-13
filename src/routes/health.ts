import { Hono } from "hono";
import { loadEnv } from "../config/env.js";
import { getSupabaseEnvBlockReason, tryCreateSupabaseAdmin } from "../lib/supabase.js";

export const healthApp = new Hono();

healthApp.get("/health", (c) => {
  const env = loadEnv();
  const supabaseBlock = getSupabaseEnvBlockReason(env);
  const supabase = supabaseBlock ? null : tryCreateSupabaseAdmin(env);
  const supabase_ok = supabase !== null;
  const supabase_hint = supabase_ok ? undefined : supabaseBlock ?? "env_looks_ok_but_createClient_failed_check_logs";

  return c.json({
    ok: true,
    service: "RITS",
    timestamp: new Date().toISOString(),
    supabase_ok,
    ...(supabase_ok ? {} : { supabase_hint }),
  });
});
