import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { parseLineEvents, replyMessage, verifyLineSignature } from "../lib/line.js";
import { handleRitsLineText } from "../services/ritsService.js";
import { logger } from "../lib/logger.js";

/** テキスト以外の message イベントから replyToken を1つ取る（無言回避用） */
function firstNonTextMessageReplyToken(events: unknown[]): string | null {
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const o = ev as Record<string, unknown>;
    if (o.type !== "message" || typeof o.replyToken !== "string") continue;
    const m = o.message;
    if (!m || typeof m !== "object") continue;
    const msgType = (m as { type?: string }).type;
    if (msgType && msgType !== "text") return o.replyToken;
  }
  return null;
}

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
    const rawList = (json as { events?: unknown[] }).events ?? [];

    let handledTexts = 0;
    for (const ev of events) {
      const text = ev.message.text?.trim();
      if (!text) continue;
      handledTexts += 1;
      await handleRitsLineText({
        deps: { env, supabase, openai },
        replyToken: ev.replyToken,
        text,
      });
    }

    if (handledTexts === 0 && rawList.length > 0) {
      const token = firstNonTextMessageReplyToken(rawList);
      if (token) {
        const res = await replyMessage({
          channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
          replyToken: token,
          texts: ["RITS: テキストのみ対応しています。スタンプや画像のみの場合はテキストで送ってください。"],
        });
        if (!res.ok) {
          logger.warn("LINE fallback reply failed", { status: res.status, body: res.body.slice(0, 500) });
        }
      } else {
        logger.warn("LINE webhook: テキストを処理できませんでした", {
          raw_event_types: rawList.map((e) =>
            e && typeof e === "object" && "type" in e ? (e as { type?: string }).type : "?",
          ),
        });
      }
    }

    return c.text("OK", 200);
  });

  return app;
}
