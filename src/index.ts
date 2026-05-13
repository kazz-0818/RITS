import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { tryCreateSupabaseAdmin } from "./lib/supabase.js";
import { listMissingOrBrokenTables, probeRitsPublicTables } from "./lib/supabaseSchemaCheck.js";
import { healthApp } from "./routes/health.js";
import { createAdminApp } from "./routes/admin.js";
import { createLineWebhookApp } from "./routes/lineWebhook.js";

let env: ReturnType<typeof loadEnv>;
try {
  env = loadEnv();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  // Render のログに必ず出す（起動前に落ちると「Deploy failed」だけになりがち）
  console.error("[RITS] FATAL: 環境変数が不正です。Render Dashboard の Environment で必須シークレットを確認してください。");
  console.error(msg);
  process.exit(1);
}
const app = new Hono();

app.route("/", healthApp);
// LINE は /admin の認証ミドルウェアの対象外。admin を先にマウントすると * が webhook を潰すため順序とスコープに注意。
app.route("/", createLineWebhookApp(env));
app.route("/", createAdminApp(env));

app.onError((err, c) => {
  logger.error("Unhandled error", { err: err instanceof Error ? err.message : String(err) });
  return c.json({ ok: false, error: "internal_error" }, 500);
});

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
    hostname: "0.0.0.0",
  },
  (info) => {
    logger.info("RITS server listening", { port: info.port, nodeEnv: env.NODE_ENV });
    void (async () => {
      const s = tryCreateSupabaseAdmin(env);
      if (!s) {
        logger.warn("起動時診断: Supabase クライアントを作成できません（環境変数を確認）");
        return;
      }
      const probeMs = 8000;
      const raced = await Promise.race([
        probeRitsPublicTables(s).then((r) => ({ kind: "ok" as const, r })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          setTimeout(() => resolve({ kind: "timeout" }), probeMs);
        }),
      ]);
      if (raced.kind === "timeout") {
        logger.warn("起動時診断: テーブルプローブがタイムアウト（手動で GET /health/supabase-tables）", {
          probeMs,
        });
        return;
      }
      const { allOk, probes } = raced.r;
      if (!allOk) {
        logger.error("起動時診断: Supabase 必須テーブルに問題があります", {
          missing: listMissingOrBrokenTables(probes),
        });
      } else {
        logger.info("起動時診断: Supabase 必須テーブル OK");
      }
    })();
  },
);
