import { z } from "zod";
import { normalizeSupabaseProjectUrl, stripEnvValue } from "../lib/envString.js";

const EnvString = z.preprocess((v) => stripEnvValue(v), z.string().min(1));

/** 未設定可（Render で空のシークレットを作れない・任意運用向け） */
const EnvStringOptional = z.preprocess((v) => stripEnvValue(v), z.string());

const SupabaseUrl = z.preprocess((v) => normalizeSupabaseProjectUrl(v), z.string().min(1));

export const EnvSchema = z.object({
  OPENAI_API_KEY: EnvString,
  /** 未設定時はビルド/デプロイを落とさないよう既定モデル */
  OPENAI_MODEL: z.preprocess((v) => {
    const s = stripEnvValue(v);
    return s.length === 0 ? "gpt-4o-mini" : s;
  }, z.string().min(1)),
  LINE_CHANNEL_ACCESS_TOKEN: EnvString,
  LINE_CHANNEL_SECRET: EnvString,
  LINE_OWNER_USER_ID: EnvStringOptional,
  SUPABASE_URL: SupabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: EnvString,
  ADMIN_API_KEY: EnvString,
  APP_BASE_URL: EnvString,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment variables: ${msg}`);
  }
  return parsed.data;
}
