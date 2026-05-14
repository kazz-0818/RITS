import { Hono } from "hono";
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { getSupabaseEnvBlockReason, takeLastSupabaseCreateClientError, tryCreateSupabaseAdmin } from "../lib/supabase.js";
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

const SUPABASE_UNAVAILABLE_LINES = [
  "RITS: 正式ログ台帳の Supabase に接続できていません（監査・保存・生成処理は実行できません）。",
  "Render の SUPABASE_URL（https の Project URL）と SUPABASE_SERVICE_ROLE_KEY（service_role）を確認し、ブラウザで /health と /health/supabase-tables を開いてください。",
] as const;

type LineDeps = { env: Env; supabase: SupabaseClient; openai: OpenAI };

/**
 * Supabase 未接続時でも LINE には必ず返す（無反応にしない）。
 * 台帳は Supabase が正という思想に沿い、復旧手順のみ案内する。
 */
async function processLineWebhookNoSupabase(params: {
  env: Env;
  events: LineMessageEvent[];
  rawList: unknown[];
  reason: string;
}): Promise<void> {
  const { env, events, rawList, reason } = params;
  let anyText = false;

  for (const ev of events) {
    const text = ev.message.text?.trim();
    if (!text) continue;
    anyText = true;
    const res = await replyMessage({
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      replyToken: ev.replyToken,
      texts: [...SUPABASE_UNAVAILABLE_LINES, `（診断: ${reason.slice(0, 120)}）`],
    });
    if (!res.ok) {
      logger.warn("LINE no-supabase reply failed", { status: res.status, body: res.body.slice(0, 500) });
    }
  }

  if (!anyText && rawList.length > 0) {
    const token = firstNonTextMessageReplyToken(rawList);
    if (token) {
      const res = await replyMessage({
        channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
        replyToken: token,
        texts: [
          ...SUPABASE_UNAVAILABLE_LINES,
          "テキストでの送信をお願いします（スタンプのみの場合は上記の通りです）。",
        ],
      });
      if (!res.ok) {
        logger.warn("LINE no-supabase fallback reply failed", { status: res.status, body: res.body.slice(0, 500) });
      }
    } else {
      logger.warn("LINE webhook: Supabase 未接続かつテキストイベントなし", {
        reason,
        raw_event_types: rawList.map((e) =>
          e && typeof e === "object" && "type" in e ? (e as { type?: string }).type : "?",
        ),
      });
    }
  }
}

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

  /** ブラウザや監視ツールの GET/HEAD。LINE の検証は POST + X-Line-Signature */
  app.get("/webhook/line", (c) =>
    c.text(
      "RITS LINE Webhook: POST only. Set Messaging API channel secret to Render LINE_CHANNEL_SECRET (same channel as this Webhook URL).",
      200,
    ),
  );

  app.post("/webhook/line", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-line-signature");

    if (!signature?.trim()) {
      logger.warn(
        "LINE webhook: X-Line-Signature がありません（LINE 以外からの POST の可能性）。コンソールの「許可されていないリクエスト」は多くの場合、別タブ・セッション切れ、または署名不一致です。",
      );
      return c.text("Forbidden", 403);
    }

    const ok = verifyLineSignature({
      channelSecret: env.LINE_CHANNEL_SECRET,
      rawBody,
      signatureHeader: signature,
    });
    if (!ok) {
      logger.warn(
        "LINE webhook: 署名検証に失敗しました。LINE Developers → 対象の Messaging API チャネル → Channel secret を再コピーし、Render の LINE_CHANNEL_SECRET と一致させてください（別チャネルの secret は不可）。",
      );
      return c.text("Forbidden", 403);
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

    const supabaseBlock = getSupabaseEnvBlockReason(env);
    const supabase = supabaseBlock ? null : tryCreateSupabaseAdmin(env);
    const createClientErr = !supabaseBlock && !supabase ? takeLastSupabaseCreateClientError() : null;
    const reason =
      supabaseBlock ??
      createClientErr ??
      "Supabase クライアントを作成できません（Render ログで「Supabase createClient failed」を検索）";

    if (!supabase) {
      logger.warn("LINE webhook: Supabase を利用できません（LINE には復旧案内を返します）", {
        reason,
        hint: "GET /health で supabase_hint・supabase_jwt_role を確認してください",
        raw_event_count: rawList.length,
        parsed_text_message_count: events.length,
      });
      void processLineWebhookNoSupabase({ env, events, rawList, reason }).catch((err) => {
        logger.error("LINE webhook no-supabase task failed", { err: String(err) });
      });
      return c.text("OK", 200);
    }

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
