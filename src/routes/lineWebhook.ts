import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { parseLineEvents, replyMessage, verifyLineSignature } from "../lib/line.js";
import { handleRitsLineText } from "../services/ritsService.js";
import { logger } from "../lib/logger.js";

/** Webhook JSON の events を配列として取り出す（parseLineEvents と同様の扱い） */
function coerceWebhookEvents(json: unknown): unknown[] {
  if (!json || typeof json !== "object") return [];
  const ev = (json as { events?: unknown }).events;
  return Array.isArray(ev) ? ev : [];
}

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
    const rawList = coerceWebhookEvents(json);

    logger.info("LINE webhook", {
      raw_event_count: rawList.length,
      parsed_text_message_count: events.length,
    });

    let anyTextInteraction = false;
    for (const ev of events) {
      const text = ev.message.text?.trim();
      if (!text) continue;

      try {
        await handleRitsLineText({
          deps: { env, supabase, openai },
          replyToken: ev.replyToken,
          text,
        });
        anyTextInteraction = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error("handleRitsLineText threw", { err: msg });
        try {
          const res = await replyMessage({
            channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
            replyToken: ev.replyToken,
            texts: [
              "RITS: 処理中にエラーが発生しました。OpenAIのキーやモデル名、Supabaseのテーブル作成を確認してください。",
            ],
          });
          if (!res.ok) {
            logger.warn("LINE error reply failed", { status: res.status, body: res.body.slice(0, 500) });
          }
        } catch (e2) {
          logger.error("LINE error reply threw", { err: String(e2) });
        }
        anyTextInteraction = true;
      }
    }

    if (!anyTextInteraction && rawList.length > 0) {
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
