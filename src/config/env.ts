import { z } from "zod";

const PlaceholderString = z.string().min(1);

export const EnvSchema = z.object({
  OPENAI_API_KEY: PlaceholderString,
  OPENAI_MODEL: PlaceholderString,
  LINE_CHANNEL_ACCESS_TOKEN: PlaceholderString,
  LINE_CHANNEL_SECRET: PlaceholderString,
  LINE_OWNER_USER_ID: PlaceholderString,
  SUPABASE_URL: PlaceholderString,
  SUPABASE_SERVICE_ROLE_KEY: PlaceholderString,
  ADMIN_API_KEY: PlaceholderString,
  APP_BASE_URL: PlaceholderString,
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
