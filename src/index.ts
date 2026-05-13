import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { healthApp } from "./routes/health.js";
import { createAdminApp } from "./routes/admin.js";
import { createLineWebhookApp } from "./routes/lineWebhook.js";

const env = loadEnv();
const app = new Hono();

app.route("/", healthApp);
app.route("/", createAdminApp(env));
app.route("/", createLineWebhookApp(env));

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
  },
);
