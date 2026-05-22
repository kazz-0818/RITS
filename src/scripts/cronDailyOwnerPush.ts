/**
 * Render Cron 用: Web サービスを起こし、日次監査を LINE_OWNER_USER_ID へ push する。
 * スケジュールは render.yaml（UTC 0:00 = JST 9:00）。
 */
import "dotenv/config";
import { stripEnvValue } from "../lib/envString.js";

/** 本番 Render URL を直接叩く（Cron / 手動実行用） */
const DEFAULT_RENDER_APP_URL = "https://rits-gj2m.onrender.com";

function resolveAppBaseUrl(): string {
  const renderUrl = stripEnvValue(process.env.RITS_RENDER_URL);
  if (renderUrl.length > 0) {
    return renderUrl.replace(/\/+$/, "");
  }
  const raw = stripEnvValue(process.env.APP_BASE_URL);
  if (raw.length > 0) {
    return raw.replace(/\/+$/, "");
  }
  const host = stripEnvValue(process.env.RITS_WEB_HOST);
  if (host.length > 0) {
    const h = host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `https://${h}`;
  }
  if (stripEnvValue(process.env.NODE_ENV) === "production") {
    return DEFAULT_RENDER_APP_URL;
  }
  return "";
}

async function main(): Promise<void> {
  const base = resolveAppBaseUrl();
  const adminKey = stripEnvValue(process.env.ADMIN_API_KEY);

  if (!base || !adminKey) {
    console.error(
      "[cronDailyOwnerPush] APP_BASE_URL（または RITS_WEB_HOST）と ADMIN_API_KEY が必要です",
    );
    process.exit(1);
  }

  const healthUrl = `${base}/health`;
  console.log("[cronDailyOwnerPush] wake GET", healthUrl);
  try {
    const healthRes = await fetch(healthUrl, { method: "GET" });
    console.log("[cronDailyOwnerPush] health", healthRes.status);
    if (!healthRes.ok) {
      await new Promise((r) => setTimeout(r, 4000));
    }
  } catch (e) {
    console.warn("[cronDailyOwnerPush] health wake failed (continuing)", e);
    await new Promise((r) => setTimeout(r, 5000));
  }

  const url = `${base}/admin/reports/daily/push-owner`;
  console.log("[cronDailyOwnerPush] POST", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-api-key": adminKey,
    },
    body: JSON.stringify({ force: false }),
  });

  const body = await res.text();
  console.log("[cronDailyOwnerPush] status", res.status, body.slice(0, 2000));

  if (!res.ok) {
    process.exit(1);
  }

  let parsed: { ok?: boolean; pushed?: boolean; reason?: string };
  try {
    parsed = JSON.parse(body) as { ok?: boolean; pushed?: boolean; reason?: string };
  } catch {
    process.exit(0);
  }

  if (parsed.ok === false) {
    process.exit(1);
  }

  if (parsed.ok && parsed.pushed === false) {
    console.log("[cronDailyOwnerPush] skipped:", parsed.reason ?? "unknown");
  }
}

main().catch((e) => {
  console.error("[cronDailyOwnerPush] fatal", e);
  process.exit(1);
});
