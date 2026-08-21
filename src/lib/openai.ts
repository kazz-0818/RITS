import OpenAI from "openai";
import { z } from "zod";
import { logger } from "./logger.js";

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

export async function createChatCompletion(params: {
  client: OpenAI;
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  temperature?: number;
  response_format?: OpenAI.Chat.ChatCompletionCreateParams["response_format"];
}): Promise<string> {
  const res = await params.client.chat.completions.create({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
    response_format: params.response_format,
  });
  persistRitsOwnLlmUsage(res, params.model);
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}

/** 日次監査・レポート生成など、RITS 自身の LLM を llm_usage_events へ残す */
function persistRitsOwnLlmUsage(
  res: OpenAI.Chat.Completions.ChatCompletion,
  fallbackModel: string,
): void {
  const u = res.usage;
  const prompt = u?.prompt_tokens ?? 0;
  const completion = u?.completion_tokens ?? 0;
  if (prompt === 0 && completion === 0) return;
  void (async () => {
    try {
      const { loadEnv } = await import("../config/env.js");
      const { tryCreateSupabaseAdmin } = await import("./supabase.js");
      const { ingestLlmUsage } = await import("../services/llmUsageService.js");
      const env = loadEnv();
      const supabase = tryCreateSupabaseAdmin(env);
      if (!supabase) return;
      await ingestLlmUsage(supabase, {
        agent_name: "RITS",
        model: res.model || fallbackModel,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: u?.total_tokens ?? prompt + completion,
        source: "rits_openai",
      });
    } catch (e) {
      logger.warn("persistRitsOwnLlmUsage failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  })();
}

export async function generateText(params: {
  client: OpenAI;
  model: string;
  system: string;
  user: string;
}): Promise<string> {
  return createChatCompletion({
    client: params.client,
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });
}

export type JsonParseFailure = {
  kind: "json_parse" | "schema_mismatch";
  message: string;
  raw?: string;
  zodError?: string;
};

export async function generateJson<T>(params: {
  client: OpenAI;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}): Promise<{ ok: true; data: T } | { ok: false; failure: JsonParseFailure }> {
  const raw = await createChatCompletion({
    client: params.client,
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    response_format: { type: "json_object" },
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      failure: { kind: "json_parse", message: errMsg, raw: raw.slice(0, 8000) },
    };
  }

  const validated = params.schema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      ok: false,
      failure: {
        kind: "schema_mismatch",
        message: validated.error.message,
        raw: JSON.stringify(parsedJson).slice(0, 8000),
        zodError: validated.error.message,
      },
    };
  }

  return { ok: true, data: validated.data };
}

export async function safeGenerateJson<T>(params: {
  client: OpenAI;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  onFailure: (failure: JsonParseFailure) => T;
}): Promise<T> {
  const res = await generateJson(params);
  if (res.ok) return res.data;
  logger.warn("generateJson failed; using fallback", { failure: res.failure });
  return params.onFailure(res.failure);
}
