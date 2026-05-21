export type EnvAliasRule = {
  canonical: string;
  legacy: readonly string[];
  deprecatedLegacy?: boolean;
};

function pickFirstSet(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function applyEnvAliases(
  rules: readonly EnvAliasRule[],
  opts?: { service?: string }
): void {
  const service = opts?.service ?? "app";
  for (const rule of rules) {
    if (pickFirstSet(process.env, [rule.canonical])) continue;
    for (const leg of rule.legacy) {
      const v = pickFirstSet(process.env, [leg]);
      if (!v) continue;
      process.env[rule.canonical] = v;
      if (rule.deprecatedLegacy) {
        console.warn(
          `[veriora-env:${service}] deprecated env "${leg}" → use "${rule.canonical}"`
        );
      }
      break;
    }
  }
}

export const RITS_ENV_ALIASES: readonly EnvAliasRule[] = [
  {
    canonical: "SUPABASE_URL",
    legacy: ["RITS_SUPABASE_URL", "VERIORA_SUPABASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "SUPABASE_SERVICE_ROLE_KEY",
    legacy: ["RITS_SUPABASE_SERVICE_ROLE_KEY", "VERIORA_SUPABASE_SERVICE_ROLE_KEY"],
    deprecatedLegacy: true,
  },
  {
    canonical: "LINE_CHANNEL_ACCESS_TOKEN",
    legacy: ["RITS_LINE_CHANNEL_ACCESS_TOKEN"],
    deprecatedLegacy: true,
  },
  {
    canonical: "LINE_CHANNEL_SECRET",
    legacy: ["RITS_LINE_CHANNEL_SECRET"],
    deprecatedLegacy: true,
  },
  {
    canonical: "LINE_OWNER_USER_ID",
    legacy: ["RITS_LINE_OWNER_USER_ID"],
    deprecatedLegacy: true,
  },
  {
    canonical: "DATABASE_URL",
    legacy: ["VERIORA_DATABASE_URL", "RITS_DATABASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "APP_BASE_URL",
    legacy: ["RITS_APP_BASE_URL", "VERIORA_PUBLIC_BASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "OPENAI_API_KEY",
    legacy: ["RITS_OPENAI_API_KEY", "VERIORA_OPENAI_API_KEY"],
    deprecatedLegacy: true,
  },
];

export function applyRitsEnvAliases(): void {
  applyEnvAliases(RITS_ENV_ALIASES, { service: "rits" });
}
