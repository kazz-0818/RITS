import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import { logger } from "./logger.js";
import { stripEnvValue } from "./envString.js";

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

/** 秘密を返さず、診断用の短い理由だけ（/health 向け） */
export function getSupabaseEnvBlockReason(env: Env): string | null {
  const url = stripEnvValue(env.SUPABASE_URL);
  const key = stripEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);
  if (url.includes("ここに")) return "SUPABASE_URL に「ここに」が含まれています（プレースホルダーのままです）";
  if (key.includes("ここに")) return "SUPABASE_SERVICE_ROLE_KEY に「ここに」が含まれています（プレースホルダーのままです）";
  if (!url) return "SUPABASE_URL が空です";
  if (!key) return "SUPABASE_SERVICE_ROLE_KEY が空です";
  if (/^postgres(ql)?:\/\//i.test(url)) {
    return "SUPABASE_URL に DB 接続文字列(postgresql://...)が入っています。Supabaseの Settings → API の「Project URL」(https://xxxx.supabase.co) を設定してください";
  }
  if (!isLikelyValidHttpUrl(url)) return "SUPABASE_URL が https:// で始まる有効なURLではありません";
  if (key.length < 30) return "SUPABASE_SERVICE_ROLE_KEY が短すぎます（anon key や誤コピーでないか確認）";
  return null;
}

/**
 * Supabase URL / service role が未設定のプレースホルダー状態では null を返す。
 * これにより Render/ローカルで `/health` だけ先に確認できる。
 */
export function tryCreateSupabaseAdmin(env: Env): SupabaseClient | null {
  const url = stripEnvValue(env.SUPABASE_URL);
  const key = stripEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);

  if (url.includes("ここに")) return null;
  if (key.includes("ここに")) return null;
  if (!isLikelyValidHttpUrl(url)) return null;
  if (!key || key.length < 30) return null;

  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Supabase createClient failed", { err: msg });
    return null;
  }
}

export function createSupabaseAdmin(env: Env): SupabaseClient {
  const c = tryCreateSupabaseAdmin(env);
  if (!c) {
    const hint = getSupabaseEnvBlockReason(env) ?? "unknown";
    throw new Error(`Supabase is not configured: ${hint}`);
  }
  return c;
}
