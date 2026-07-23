import type { SupabaseClient } from "@supabase/supabase-js";
import { tryGetPool } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { listMessageFeedSince, type MessageFeedRow } from "./supabase/repositories/messageFeed.js";
import * as logService from "./logService.js";

const TARGET_KEYS = ["near", "sera", "irie", "lram"] as const;

const AGENT_CODE: Record<string, string> = {
  near: "NEAR",
  sera: "SERA",
  irie: "IRIE",
  lram: "LRAM",
};

type Pair = {
  agentKey: string;
  agentName: string;
  userMessage: string;
  agentReply: string | null;
  logKey: string;
  intent: string;
  source: string;
  metadata: Record<string, unknown>;
};

function pairFeedMessages(rows: MessageFeedRow[]): Pair[] {
  const byConv = new Map<string, MessageFeedRow[]>();
  for (const row of rows) {
    const list = byConv.get(row.conversation_id) ?? [];
    list.push(row);
    byConv.set(row.conversation_id, list);
  }

  const pairs: Pair[] = [];
  for (const [, msgs] of byConv) {
    const ordered = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < ordered.length; i++) {
      const inbound = ordered[i];
      if (!inbound) continue;
      if (inbound.direction !== "inbound" && inbound.role !== "user") continue;
      const userText = (inbound.text ?? "").trim();
      if (!userText) continue;

      let outbound: MessageFeedRow | null = null;
      for (let j = i + 1; j < ordered.length; j++) {
        const cand = ordered[j];
        if (!cand) continue;
        if (cand.agent_key !== inbound.agent_key) continue;
        if (cand.direction === "outbound" || cand.role === "assistant") {
          outbound = cand;
          break;
        }
        // 次の inbound が来たら打ち切り
        if (cand.direction === "inbound" || cand.role === "user") break;
      }

      const agentKey = inbound.agent_key.toLowerCase();
      const agentName = AGENT_CODE[agentKey] ?? agentKey.toUpperCase();
      const reply = (outbound?.text ?? "").trim() || null;
      const logKey = outbound
        ? `feed:${inbound.id}:${outbound.id}`
        : `feed:noreply:${inbound.id}`;

      pairs.push({
        agentKey,
        agentName,
        userMessage: userText.slice(0, 8000),
        agentReply: reply ? reply.slice(0, 8000) : null,
        logKey,
        intent: reply ? "message_feed_pair" : "no_reply",
        source: inbound.source ?? "message_feed",
        metadata: {
          rits_log_key: logKey,
          rits_from_message_feed: true,
          rits_skip_canonical_mirror: true,
          feed_inbound_id: inbound.id,
          feed_outbound_id: outbound?.id ?? null,
          conversation_id: inbound.conversation_id,
          line_user_id: inbound.line_user_id,
        },
      });
    }
  }
  return pairs;
}

/**
 * 正規 message_feed を public.agent_logs へ冪等に取り込む（既存 LLM 監査パイプラインへ接続）。
 * 複写元なので canonical mirror は metadata で抑止する。
 */
export async function ingestMessageFeedToAgentLogs(params: {
  supabase: SupabaseClient;
  sinceIso: string;
  limit?: number;
}): Promise<{ pairs: number; created: number; duplicates: number }> {
  const db = tryGetPool();
  if (!db) return { pairs: 0, created: 0, duplicates: 0 };

  try {
    const rows = await listMessageFeedSince(db, {
      sinceIso: params.sinceIso,
      agentKeys: [...TARGET_KEYS],
      limit: params.limit ?? 800,
    });
    const pairs = pairFeedMessages(rows).filter((p) =>
      (TARGET_KEYS as readonly string[]).includes(p.agentKey)
    );

    let created = 0;
    let duplicates = 0;
    for (const p of pairs) {
      const res = await logService.createAgentLogDeduped(params.supabase, {
        agent_name: p.agentName,
        user_message: p.userMessage,
        agent_reply: p.agentReply,
        intent: p.intent,
        source: p.source,
        metadata: p.metadata,
      });
      if (res.duplicate) duplicates += 1;
      else created += 1;
    }
    return { pairs: pairs.length, created, duplicates };
  } catch (e) {
    logger.warn("message_feed ingest failed (non-fatal)", {
      err: e instanceof Error ? e.message : String(e),
    });
    return { pairs: 0, created: 0, duplicates: 0 };
  }
}
