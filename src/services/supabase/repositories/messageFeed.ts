import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export type MessageFeedRow = {
  id: string;
  conversation_id: string;
  agent_id: string;
  agent_key: string;
  agent_code: string;
  direction: string;
  role: string;
  text: string | null;
  source: string | null;
  line_user_id: string | null;
  conversation_key: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

/** 正規 message_feed から直近メッセージを取得（読取専用） */
export async function listMessageFeedSince(
  db: VelioraDb,
  params: {
    sinceIso: string;
    agentKeys?: string[];
    limit?: number;
  }
): Promise<MessageFeedRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 2000);
  const keys = (params.agentKeys ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);

  const r = await db.query<MessageFeedRow>(
    `SELECT
       f.id::text AS id,
       f.conversation_id::text AS conversation_id,
       f.agent_id::text AS agent_id,
       f.agent_key,
       f.agent_code,
       f.direction,
       f.role,
       f.text,
       f.source,
       f.line_user_id,
       f.conversation_key,
       f.created_at::text AS created_at,
       f.metadata
     FROM ${VERIORA_TABLES.messageFeed} f
     WHERE f.created_at >= $1::timestamptz
       AND ($2::text[] IS NULL OR cardinality($2::text[]) = 0 OR f.agent_key = ANY($2))
     ORDER BY f.created_at ASC
     LIMIT $3`,
    [params.sinceIso, keys.length > 0 ? keys : null, limit]
  );
  return r.rows;
}

export type HandoffStatRow = {
  from_agent_key: string | null;
  to_agent_key: string | null;
  n: string;
};

export async function countHandoffsSince(
  db: VelioraDb,
  sinceIso: string
): Promise<HandoffStatRow[]> {
  const r = await db.query<HandoffStatRow>(
    `SELECT
       fa.agent_key AS from_agent_key,
       ta.agent_key AS to_agent_key,
       COUNT(*)::text AS n
     FROM ${VERIORA_TABLES.agentHandoffLogs} h
     LEFT JOIN ${VERIORA_TABLES.aiAgents} fa ON fa.id = h.from_agent_id
     LEFT JOIN ${VERIORA_TABLES.aiAgents} ta ON ta.id = h.to_agent_id
     WHERE h.created_at >= $1::timestamptz
     GROUP BY fa.agent_key, ta.agent_key
     ORDER BY COUNT(*) DESC`,
    [sinceIso]
  );
  return r.rows;
}

export async function countRoutingSince(
  db: VelioraDb,
  sinceIso: string
): Promise<{ n: number }> {
  const r = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${VERIORA_TABLES.agentRoutingLogs}
     WHERE created_at >= $1::timestamptz`,
    [sinceIso]
  );
  return { n: Number.parseInt(r.rows[0]?.n ?? "0", 10) || 0 };
}

export type DailyScoreTrendRow = {
  review_date: string;
  agent_key: string;
  agent_code: string;
  score_overall: number | null;
};

export async function listDailyScoreTrends(
  db: VelioraDb,
  params: { days: number; agentKeys?: string[] }
): Promise<DailyScoreTrendRow[]> {
  const days = Math.min(Math.max(params.days, 1), 30);
  const keys = (params.agentKeys ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const r = await db.query<DailyScoreTrendRow>(
    `SELECT
       r.review_date::text AS review_date,
       a.agent_key,
       a.code AS agent_code,
       r.score_overall::float8 AS score_overall
     FROM ${VERIORA_TABLES.agentQualityReviews} r
     JOIN ${VERIORA_TABLES.aiAgents} a ON a.id = r.agent_id
     WHERE r.review_date >= (CURRENT_DATE - ($1::int || ' days')::interval)::date
       AND ($2::text[] IS NULL OR cardinality($2::text[]) = 0 OR a.agent_key = ANY($2))
     ORDER BY r.review_date ASC, a.agent_key ASC`,
    [days, keys.length > 0 ? keys : null]
  );
  return r.rows;
}
