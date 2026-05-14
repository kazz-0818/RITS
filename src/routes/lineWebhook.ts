import { Hono } from "hono";
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { getSupabaseEnvBlockReason, tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { parseLineEvents, replyMessage, verifyLineSignature } from "../lib/line.js";
import type { LineMessageEvent } from "../types/line.js";
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

type LineDeps = { env: Env; supabase: SupabaseClient; openai: OpenAI };

/**
 * LINE は Webhook の HTTP 応答を短時間で要求するため、ACK（200）後に実行する。
 * replyToken は数十秒以内に reply API で使う必要がある点に注意。
 */
async function processLineWebhookAfterAck(params: {
  deps: LineDeps;
  events: LineMessageEvent[];
  rawList: unknown[];
}): Promise<void> {
  const { deps, events, rawList } = params;
  let anyTextInteraction = false;

  for (const ev of events) {
    const text = ev.message.text?.trim();
    if (!text) continue;

    try {
      await handleRitsLineText({
        deps,
        replyToken: ev.replyToken,
        text,
      });
      anyTextInteraction = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("handleRitsLineText threw", { err: msg });
      try {
        const res = await replyMessage({
          channelAccessToken: deps.env.LINE_CHANNEL_ACCESS_TOKEN,
          replyToken: ev.replyToken,
          texts: [
            "RITS: 処理中にエラーが発生しました。/health と /health/supabase-tables、および OpenAI のキー・モデルを確認してください。",
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
        channelAccessToken: deps.env.LINE_CHANNEL_ACCESS_TOKEN,
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

    const supabaseBlock = getSupabaseEnvBlockReason(env);
    const supabase = supabaseBlock ? null : tryCreateSupabaseAdmin(env);
    if (!supabase) {
      logger.warn("LINE webhook: Supabase を利用できません", {
        reason: supabaseBlock ?? "createClient_returned_null",
        hint: "GET /health で supabase_hint・supabase_jwt_role を確認してください",
      });
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

    logger.info("LINE webhook accepted (processing async)", {
      raw_event_count: rawList.length,
      parsed_text_message_count: events.length,
    });

    const deps: LineDeps = { env, supabase, openai };
    void processLineWebhookAfterAck({ deps, events, rawList }).catch((err) => {
      logger.error("LINE webhook background task failed", { err: String(err) });
    });

    return c.text("OK", 200);
  });

  return app;
}
