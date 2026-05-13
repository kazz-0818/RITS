import { z } from "zod";

/** LINE Messaging API: webhook の最小構造（必要部分のみ） */
export const LineTextMessageSchema = z
  .object({
    type: z.literal("text"),
    id: z.string().optional(),
    text: z.string(),
  })
  .passthrough();

export const LineMessageEventSchema = z.object({
  type: z.literal("message"),
  replyToken: z.string(),
  source: z
    .object({
      type: z.string(),
      userId: z.string().optional(),
    })
    .passthrough(),
  message: LineTextMessageSchema,
});

export const LineWebhookBodySchema = z.object({
  destination: z.string().optional(),
  /** 欠落・null・非配列は空配列として扱う（LINE の揺れでイベントが全落ちしないように） */
  events: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())),
});

export type LineTextMessage = z.infer<typeof LineTextMessageSchema>;
export type LineMessageEvent = z.infer<typeof LineMessageEventSchema>;
