import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";

function isLikelyValidHttpUrl(value: string): boolean {
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Supabase URL / service role が未設定のプレースホルダー状態では null を返す。
 * これにより Render/ローカルで `/health` だけ先に確認できる。
 */
export function tryCreateSupabaseAdmin(env: Env): SupabaseClient | null {
  if (env.SUPABASE_URL.includes("ここに")) return null;
  if (env.SUPABASE_SERVICE_ROLE_KEY.includes("ここに")) return null;
  if (!isLikelyValidHttpUrl(env.SUPABASE_URL)) return null;
  return createClient(env.SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseAdmin(env: Env): SupabaseClient {
  const c = tryCreateSupabaseAdmin(env);
  if (!c) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL (https://...) and SUPABASE_SERVICE_ROLE_KEY in .env",
    );
  }
  return c;
}
