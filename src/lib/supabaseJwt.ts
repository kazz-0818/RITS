import { stripEnvValue } from "./envString.js";

export type SupabaseJwtRoleGuess = "service_role" | "anon" | "authenticated" | "unknown" | "invalid";

/**
 * JWT を署名検証せず payload の role のみ参照（環境変数が service_role かどうかの切り分け用）
 */
export function peekSupabaseJwtRole(rawKey: unknown): SupabaseJwtRoleGuess {
  const key = stripEnvValue(rawKey);
  const parts = key.split(".");
  if (parts.length < 2 || parts[1].length < 4) return "invalid";
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { role?: string };
    const r = payload.role;
    if (r === "service_role") return "service_role";
    if (r === "anon") return "anon";
    if (r === "authenticated") return "authenticated";
    return "unknown";
  } catch {
    return "invalid";
  }
}
