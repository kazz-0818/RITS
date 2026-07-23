import { loadEnv } from "../config/env.js";
import { tryGetPool } from "../db/client.js";
import { saveMessage } from "./supabase/repositories/messages.js";
import { linkConversationForAgentKey } from "./customers/lineResolve.js";

const AGENT_KEY_BY_NAME: Record<string, string> = {
  NEAR: "near",
  NEIA: "near",
  NIA: "near",
  SERA: "sera",
  IRIE: "irie",
  RITS: "rits",
  LRAM: "lram",
};

function normalizeAgentKey(agentName: string): string {
  const k = AGENT_KEY_BY_NAME[agentName.trim().toUpperCase()];
  if (k) return k;
  return agentName.trim().toLowerCase();
}

function buildConversationKey(agentKey: string, lineUserId?: string | null): string {
  const uid = (lineUserId ?? "unknown").trim();
  return `${agentKey}:line:dm:${uid}`;
}

/**
 * RITS agent_logs 作成後、DATABASE_URL + VERIORA_CANONICAL_LINE_LOG 時に veliora.messages へ best-effort 複写。
 */
export async function mirrorAgentLogToVelioraMessages(input: {
  agent_name: string;
  user_message?: string | null;
  agent_reply?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
  log_id?: string;
}): Promise<void> {
  const env = loadEnv();
  if (!env.VERIORA_CANONICAL_LINE_LOG) return;
  if (input.metadata?.rits_skip_canonical_mirror === true) return;
  if (input.metadata?.rits_from_message_feed === true) return;
  const db = tryGetPool();
  if (!db) return;

  const agentKey = normalizeAgentKey(input.agent_name);
  const lineUserId =
    typeof input.metadata?.line_user_id === "string"
      ? input.metadata.line_user_id
      : typeof input.metadata?.user_id === "string"
        ? input.metadata.user_id
        : null;
  const conversationKey = buildConversationKey(agentKey, lineUserId);

  const base = {
    agentKey,
    conversationKey,
    source: input.source ?? "line",
    lineUserId,
    legacySchema: "public",
    legacyTable: "agent_logs",
    legacyRowId: null as number | null,
    metadata: {
      ...(input.metadata ?? {}),
      rits_mirror: true,
      rits_log_id: input.log_id ?? null,
    },
  };

  try {
    if (input.user_message?.trim()) {
      await saveMessage(db, {
        ...base,
        direction: "inbound",
        role: "user",
        text: input.user_message.trim(),
      });
    }
    if (input.agent_reply?.trim()) {
      await saveMessage(db, {
        ...base,
        direction: "outbound",
        role: "assistant",
        text: input.agent_reply.trim(),
      });
    }
    if (lineUserId) {
      void linkConversationForAgentKey(db, {
        agentKey,
        conversationKey,
        lineUserId,
      }).catch(() => undefined);
    }
  } catch (e) {
    console.warn("[rits] veliora.messages mirror failed (non-fatal)", e);
  }
}
