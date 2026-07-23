import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export async function createQualityReview(
  db: VelioraDb,
  input: {
    reviewDate: string;
    agentId?: string | null;
    scoreOverall?: number | null;
    scoreUnderstanding?: number | null;
    scoreAccuracy?: number | null;
    scoreRoleAdherence?: number | null;
    scoreActionability?: number | null;
    summary?: string | null;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.agentQualityReviews} (
      review_date, agent_id, score_overall, score_understanding, score_accuracy,
      score_role_adherence, score_actionability, summary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id`,
    [
      input.reviewDate,
      input.agentId ?? null,
      input.scoreOverall ?? null,
      input.scoreUnderstanding ?? null,
      input.scoreAccuracy ?? null,
      input.scoreRoleAdherence ?? null,
      input.scoreActionability ?? null,
      input.summary ?? null,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createQualityReview: insert failed");
  return { id };
}

/** 同一 agent + 日付のレビューを取得。なければ作成し、あればスコア/要約を更新。 */
export async function getOrCreateDailyQualityReview(
  db: VelioraDb,
  input: {
    reviewDate: string;
    agentId: string;
    scoreOverall?: number | null;
    summary?: string | null;
  }
): Promise<{ id: string; created: boolean }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM ${VERIORA_TABLES.agentQualityReviews}
     WHERE agent_id = $1 AND review_date = $2::date
     LIMIT 1`,
    [input.agentId, input.reviewDate]
  );
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    await db.query(
      `UPDATE ${VERIORA_TABLES.agentQualityReviews}
       SET score_overall = COALESCE($2, score_overall),
           summary = COALESCE($3, summary)
       WHERE id = $1`,
      [existingId, input.scoreOverall ?? null, input.summary ?? null]
    );
    return { id: existingId, created: false };
  }

  const created = await createQualityReview(db, {
    reviewDate: input.reviewDate,
    agentId: input.agentId,
    scoreOverall: input.scoreOverall,
    summary: input.summary,
  });
  return { id: created.id, created: true };
}

export async function createQualityFinding(
  db: VelioraDb,
  input: {
    reviewId?: string | null;
    agentId?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    category: string;
    severity: string;
    finding: string;
    suggestion?: string | null;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.agentQualityFindings} (
      review_id, agent_id, conversation_id, message_id,
      category, severity, finding, suggestion
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id`,
    [
      input.reviewId ?? null,
      input.agentId ?? null,
      input.conversationId ?? null,
      input.messageId ?? null,
      input.category,
      input.severity,
      input.finding,
      input.suggestion ?? null,
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createQualityFinding: insert failed");
  return { id };
}

export async function createImprovementTask(
  db: VelioraDb,
  input: {
    sourceFindingId?: string | null;
    targetAgentId?: string | null;
    title: string;
    description?: string | null;
    cursorInstruction?: string | null;
    priority?: string;
    status?: string;
  }
): Promise<{ id: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ${VERIORA_TABLES.agentImprovementTasks} (
      source_finding_id, target_agent_id, title, description,
      cursor_instruction, priority, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id`,
    [
      input.sourceFindingId ?? null,
      input.targetAgentId ?? null,
      input.title,
      input.description ?? null,
      input.cursorInstruction ?? null,
      input.priority ?? "medium",
      input.status ?? "draft",
    ]
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("createImprovementTask: insert failed");
  return { id };
}

export type ImprovementTaskRow = {
  id: string;
  title: string;
  description: string | null;
  cursor_instruction: string | null;
  priority: string;
  status: string;
  created_at: string;
  target_agent_key: string | null;
  target_agent_code: string | null;
};

export async function listImprovementTasks(
  db: VelioraDb,
  params: {
    statuses: string[];
    agentKey?: string | null;
    limit?: number;
  }
): Promise<ImprovementTaskRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const statuses = params.statuses.length > 0 ? params.statuses : ["draft"];
  const agentKey = params.agentKey?.trim().toLowerCase() || null;

  const r = await db.query<ImprovementTaskRow>(
    `SELECT
       t.id,
       t.title,
       t.description,
       t.cursor_instruction,
       t.priority,
       t.status,
       t.created_at::text AS created_at,
       a.agent_key AS target_agent_key,
       a.code AS target_agent_code
     FROM ${VERIORA_TABLES.agentImprovementTasks} t
     LEFT JOIN ${VERIORA_TABLES.aiAgents} a ON a.id = t.target_agent_id
     WHERE t.status = ANY($1::text[])
       AND ($2::text IS NULL OR a.agent_key = $2)
     ORDER BY
       CASE t.priority
         WHEN 'critical' THEN 0
         WHEN 'high' THEN 1
         WHEN 'medium' THEN 2
         ELSE 3
       END,
       t.created_at DESC
     LIMIT $3`,
    [statuses, agentKey, limit]
  );
  return r.rows;
}

/** 同一監査から二重にタスクを作らないための軽い重複チェック */
export async function findImprovementTaskByAuditId(
  db: VelioraDb,
  auditId: string
): Promise<{ id: string } | null> {
  const marker = `rits_audit_id=${auditId}`;
  const r = await db.query<{ id: string }>(
    `SELECT id FROM ${VERIORA_TABLES.agentImprovementTasks}
     WHERE description LIKE $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [`%${marker}%`]
  );
  return r.rows[0] ?? null;
}

export async function getImprovementTaskByIdPrefix(
  db: VelioraDb,
  idPrefix: string
): Promise<ImprovementTaskRow | null> {
  const prefix = idPrefix.trim().toLowerCase().replace(/[^0-9a-f-]/g, "");
  if (prefix.length < 8) return null;
  const r = await db.query<ImprovementTaskRow>(
    `SELECT
       t.id,
       t.title,
       t.description,
       t.cursor_instruction,
       t.priority,
       t.status,
       t.created_at::text AS created_at,
       a.agent_key AS target_agent_key,
       a.code AS target_agent_code
     FROM ${VERIORA_TABLES.agentImprovementTasks} t
     LEFT JOIN ${VERIORA_TABLES.aiAgents} a ON a.id = t.target_agent_id
     WHERE t.id::text LIKE $1
     ORDER BY t.created_at DESC
     LIMIT 2`,
    [`${prefix}%`]
  );
  if (r.rows.length !== 1) return null;
  return r.rows[0] ?? null;
}

export async function updateImprovementTaskStatus(
  db: VelioraDb,
  input: {
    taskId: string;
    status: string;
    appendDescription?: string | null;
  }
): Promise<ImprovementTaskRow | null> {
  const updated = await db.query<{ id: string }>(
    `UPDATE ${VERIORA_TABLES.agentImprovementTasks}
     SET status = $2,
         description = CASE
           WHEN $3::text IS NULL OR btrim($3) = '' THEN description
           ELSE trim(both E'\n' FROM coalesce(description, '') || E'\n\n' || $3)
         END,
         updated_at = now()
     WHERE id = $1::uuid
     RETURNING id`,
    [input.taskId, input.status, input.appendDescription ?? null]
  );
  if (!updated.rows[0]) return null;
  return getImprovementTaskByIdPrefix(db, input.taskId);
}

export async function listAwaitingReauditTasksForAgent(
  db: VelioraDb,
  agentId: string,
  limit = 20
): Promise<ImprovementTaskRow[]> {
  const r = await db.query<ImprovementTaskRow>(
    `SELECT
       t.id,
       t.title,
       t.description,
       t.cursor_instruction,
       t.priority,
       t.status,
       t.created_at::text AS created_at,
       a.agent_key AS target_agent_key,
       a.code AS target_agent_code
     FROM ${VERIORA_TABLES.agentImprovementTasks} t
     LEFT JOIN ${VERIORA_TABLES.aiAgents} a ON a.id = t.target_agent_id
     WHERE t.target_agent_id = $1
       AND t.status = ANY($2::text[])
     ORDER BY t.created_at ASC
     LIMIT $3`,
    [agentId, ["awaiting_reaudit", "implemented"], Math.min(Math.max(limit, 1), 50)]
  );
  return r.rows;
}

export async function findRecentFindingByMarker(
  db: VelioraDb,
  marker: string,
  withinDays = 7
): Promise<{ id: string } | null> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM ${VERIORA_TABLES.agentQualityFindings}
     WHERE finding LIKE $1
       AND created_at >= now() - ($2::text || ' days')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [`%${marker}%`, String(withinDays)]
  );
  return r.rows[0] ?? null;
}
