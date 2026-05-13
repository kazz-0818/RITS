import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { parseLineEvents, verifyLineSignature } from "../lib/line.js";
import { handleRitsLineText } from "../services/ritsService.js";
import { logger } from "../lib/logger.js";

export function createLineWebhookApp(env: Env) {
  const app = new Hono();
  const openai = createOpenAIClient(env.OPENAI_API_KEY);

  app.post("/webhook/line", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-line-signature");

    const ok = verifyLineSignature({
      channelSecret: env.LINE_CHANNEL_SECRET,
      rawBody,
      signatureHeader: signature,
    });
    if (!ok) {
      return c.text("Forbidden", 403);
    }

    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) {
      // LINE は Webhook に 200 を期待する。Supabase 未設定でも受信は成功として返す（再送ループを避ける）。
      logger.warn(
        "LINE webhook: Supabase未設定のためイベントを処理しません。Renderの SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を実値にしてください。",
      );
      return c.text("OK", 200);
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody) as unknown;
    } catch {
      logger.warn("LINE webhook JSON parse failed");
      return c.text("Bad Request", 400);
    }

    const events = parseLineEvents(json);
    for (const ev of events) {
      const text = ev.message.text?.trim();
      if (!text) continue;

      await handleRitsLineText({
        deps: { env, supabase, openai },
        replyToken: ev.replyToken,
        text,
      });
    }

    return c.text("OK", 200);
  });

  return app;
}
