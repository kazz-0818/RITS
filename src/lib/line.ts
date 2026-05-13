import crypto from "node:crypto";
import type { LineMessageEvent } from "../types/line.js";
import { LineMessageEventSchema, LineWebhookBodySchema } from "../types/line.js";
import { logger } from "./logger.js";

export function verifyLineSignature(params: {
  channelSecret: string;
  rawBody: string;
  signatureHeader: string | undefined;
}): boolean {
  const sig = params.signatureHeader;
  if (!sig) return false;
  const hmac = crypto.createHmac("sha256", params.channelSecret);
  hmac.update(params.rawBody, "utf8");
  const digest = hmac.digest("base64");
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(digest, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseLineEvents(rawJson: unknown): LineMessageEvent[] {
  const parsed = LineWebhookBodySchema.safeParse(rawJson);
  if (!parsed.success) return [];

  const out: LineMessageEvent[] = [];
  for (const ev of parsed.data.events) {
    const e = LineMessageEventSchema.safeParse(ev);
    if (e.success) out.push(e.data);
  }
  return out;
}

export async function replyMessage(params: {
  channelAccessToken: string;
  replyToken: string;
  texts: string[];
}): Promise<{ ok: boolean; status: number; body: string }> {
  const messages = params.texts
    .filter((t) => t.length > 0)
    .slice(0, 5)
    .map((text) => ({ type: "text" as const, text }));

  if (messages.length === 0) {
    messages.push({ type: "text", text: "（空の応答）" });
  }

  const url = "https://api.line.me/v2/bot/message/reply";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken: params.replyToken,
      messages,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    logger.warn("LINE replyMessage failed", { status: res.status, body });
  }
  return { ok: res.ok, status: res.status, body };
}

export async function pushMessage(params: {
  channelAccessToken: string;
  to: string;
  text: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const url = "https://api.line.me/v2/bot/message/push";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.channelAccessToken}`,
    },
    body: JSON.stringify({
      to: params.to,
      messages: [{ type: "text", text: params.text }],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    logger.warn("LINE pushMessage failed", { status: res.status, body });
  }
  return { ok: res.ok, status: res.status, body };
}

/** LINE 1 メッセージあたりの上限に合わせて分割（余裕を見て 4500 文字） */
export function chunkLineText(text: string, maxLen = 4500): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, maxLen));
    rest = rest.slice(maxLen);
  }
  return chunks.length > 0 ? chunks : [""];
}
