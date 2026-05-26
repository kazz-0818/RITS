import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { applyRitsEnvAliases } from "./envAlias.js";
import { isEnvPlaceholder, normalizeSupabaseProjectUrl, stripEnvValue } from "../lib/envString.js";

loadDotenv();
applyRitsEnvAliases();

const EnvString = z.preprocess((v) => stripEnvValue(v), z.string().min(1));

/** 未設定可（Render で空のシークレットを作れない・任意運用向け） */
const EnvStringOptional = z.preprocess((v) => stripEnvValue(v), z.string());

const SupabaseUrl = z.preprocess((v) => normalizeSupabaseProjectUrl(v), z.string().min(1));

/** Render Web Service が自動で付与する公開 URL（APP_BASE_URL 未設定時のフォールバック） */
function resolveAppBaseUrl(raw: unknown): string {
  const s = stripEnvValue(raw);
  if (s.length > 0 && !isEnvPlaceholder(s)) return s;
  return stripEnvValue(process.env.RENDER_EXTERNAL_URL);
}

export const EnvSchema = z.object({
  OPENAI_API_KEY: EnvString,
  /** 未設定時はビルド/デプロイを落とさないよう既定モデル */
  OPENAI_MODEL: z.preprocess((v) => {
    const s = stripEnvValue(v);
    return s.length === 0 ? "gpt-4.1-mini" : s;
  }, z.string().min(1)),
  LINE_CHANNEL_ACCESS_TOKEN: EnvString,
  LINE_CHANNEL_SECRET: EnvString,
  LINE_OWNER_USER_ID: EnvStringOptional,
  SUPABASE_URL: SupabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: EnvString,
  ADMIN_API_KEY: EnvString,
  APP_BASE_URL: z.preprocess((v) => resolveAppBaseUrl(v), z.string().url({ message: "APP_BASE_URL または RENDER_EXTERNAL_URL が有効な https URL である必要があります" })),
  /** Veliora canonical デュアル書き込み用（任意） */
  DATABASE_URL: z.preprocess((v) => {
    const s = stripEnvValue(v);
    if (s.length === 0 || isEnvPlaceholder(s)) return undefined;
    return s;
  }, z.string().url().optional()),
  VERIORA_CUSTOMER_MASTER_ENABLED: z
    .string()
    .optional()
    .transform((s) => s !== "false" && s !== "0"),
  /** 日次レポート bundle に顧客マスター監査節を付与（DATABASE_URL 必須） */
  VERIORA_CUSTOMER_AUDIT_IN_DAILY_REPORT: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),

  VERIORA_CANONICAL_LINE_LOG: z
    .preprocess((v) => stripEnvValue(v), z.string().optional())
    .transform((s) => s !== "false" && s !== "0"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default(process.env.RENDER ? "production" : "development"),
  /** Render は PORT を自動付与。未設定時のみ 3000（ローカル） */
  PORT: z.preprocess((v) => {
    const s = stripEnvValue(v ?? process.env.PORT);
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 3000;
  }, z.number().int().positive()),
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
