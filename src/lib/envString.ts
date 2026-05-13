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
