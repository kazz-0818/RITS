import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import WebSocket from "ws";
import type { Env } from "../config/env.js";
import { logger } from "./logger.js";
import { stripEnvValue } from "./envString.js";
import { peekSupabaseJwtRole } from "./supabaseJwt.js";

/** Node 22 未満はグローバル WebSocket が無く、Realtime 初期化で createClient が落ちるため `ws` を渡す */
function supabaseAdminClientOptions(): {
  auth: { persistSession: false; autoRefreshToken: false };
  realtime?: { transport: WebSocketLikeConstructor };
} {
  const auth = { persistSession: false, autoRefreshToken: false } as const;
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (Number.isFinite(major) && major >= 22) {
    return { auth };
  }
  return {
    auth,
    realtime: {
      transport: WebSocket as unknown as WebSocketLikeConstructor,
    },
  };
}

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
  const jwtRole = peekSupabaseJwtRole(key);
  if (jwtRole === "anon") {
    return "SUPABASE_SERVICE_ROLE_KEY に anon key（公開用）が入っています。Dashboard → Settings → API の service_role シークレットを設定してください";
  }
  if (jwtRole === "authenticated") {
    return "SUPABASE_SERVICE_ROLE_KEY の JWT role が authenticated です。service_role キーを貼り付けてください";
  }
  if (jwtRole === "invalid") {
    return "SUPABASE_SERVICE_ROLE_KEY が JWT として解釈できません（Settings → API の service_role の長いトークンをそのまま貼り付けてください）";
  }
  return null;
}

/** /health 用: 接続先がどの Supabase プロジェクトか（秘密は出さない） */
export function describeSupabaseHttpUrl(url: string): { host: string; projectRef: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const m = /^([a-z0-9-]+)\.supabase\.co$/.exec(host);
    return { host, projectRef: m?.[1] ?? null };
  } catch {
    return { host: "", projectRef: null };
  }
}

/**
 * createClient が例外で失敗したときの直近メッセージ（LINE 診断用。秘密は含めない）
 */
let lastSupabaseCreateClientError: string | null = null;

export function takeLastSupabaseCreateClientError(): string | null {
  const m = lastSupabaseCreateClientError;
  lastSupabaseCreateClientError = null;
  return m;
}

/**
 * Supabase URL / service role が未設定のプレースホルダー状態では null を返す。
 * これにより Render/ローカルで `/health` だけ先に確認できる。
 */
export function tryCreateSupabaseAdmin(env: Env): SupabaseClient | null {
  lastSupabaseCreateClientError = null;
  const url = stripEnvValue(env.SUPABASE_URL);
  const key = stripEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);

  if (url.includes("ここに")) return null;
  if (key.includes("ここに")) return null;
  if (!isLikelyValidHttpUrl(url)) return null;
  if (!key || key.length < 30) return null;

  const jwtRole = peekSupabaseJwtRole(key);
  if (jwtRole === "anon" || jwtRole === "authenticated") return null;
  if (jwtRole === "invalid") return null;

  try {
    return createClient(url, key, supabaseAdminClientOptions());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastSupabaseCreateClientError = msg;
    logger.error("Supabase createClient failed", { err: msg });
    return null;
  }
}

export function createSupabaseAdmin(env: Env): SupabaseClient {
  const c = tryCreateSupabaseAdmin(env);
  if (!c) {
    const hint =
      getSupabaseEnvBlockReason(env) ?? takeLastSupabaseCreateClientError() ?? "unknown";
    throw new Error(`Supabase is not configured: ${hint}`);
  }
  return c;
}
