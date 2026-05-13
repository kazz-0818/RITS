import { z } from "zod";

/** LINE Messaging API: webhook の最小構造（必要部分のみ） */
export const LineTextMessageSchema = z.object({
  type: z.literal("text"),
  id: z.string(),
  text: z.string(),
});

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
  events: z.array(z.unknown()),
});

export type LineTextMessage = z.infer<typeof LineTextMessageSchema>;
export type LineMessageEvent = z.infer<typeof LineMessageEventSchema>;
