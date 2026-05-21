/** Render / ダッシュボードからのコピペで付きがちな BOM・前後空白・全体を囲む引用符を除去 */
export function stripEnvValue(v: unknown): string {
  if (typeof v !== "string") return "";
  let s = v.trim();
  if (s.startsWith("\uFEFF")) s = s.slice(1).trim();
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

/** `.env.example` の日本語プレースホルダーや Render テンプレ URL（未設定扱い） */
export function isEnvPlaceholder(s: string): boolean {
  const v = s.trim();
  if (!v) return true;
  if (v.includes("ここに")) return true;
  if (/your-[a-z-]*service\.onrender\.com/i.test(v)) return true;
  return false;
}

/** Supabase の「Project URL」コピペで https が抜けたり、/rest/v1 が付いたりするのを直す */
export function normalizeSupabaseProjectUrl(raw: unknown): string {
  let s = stripEnvValue(raw);
  s = s.replace(/\/+$/, "");
  // Dashboard の一部 UI や誤コピーで末尾に REST パスが付く
  s = s.replace(/\/rest\/v1\/?$/i, "");
  s = s.replace(/\/storage\/v1\/?$/i, "");
  s = s.replace(/\/auth\/v1\/?$/i, "");
  s = s.replace(/\/v1\/?$/i, "");
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9-]+\.supabase\.co$/i.test(s)) {
    s = `https://${s}`;
  }
  // supabase.co は https 前提
  if (/^http:\/\/[^/]+\.supabase\.co/i.test(s)) {
    s = `https://${s.slice("http://".length)}`;
  }
  return s;
}
