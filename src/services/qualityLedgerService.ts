import { tryGetPool } from "../db/client.js";
import { getJstDateString } from "../lib/date.js";
import { logger } from "../lib/logger.js";
import type { AuditResultPayload } from "../types/audit.js";
import { getAgentByKey } from "./supabase/repositories/agents.js";
import {
  createImprovementTask,
  createQualityFinding,
  findImprovementTaskByAuditId,
  getOrCreateDailyQualityReview,
} from "./supabase/repositories/qualityReviews.js";

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

function mapSeverity(riskLevel: string): string {
  const r = riskLevel.trim().toLowerCase();
  if (r === "critical" || r === "high" || r === "medium" || r === "low") return r;
  return "medium";
}

function mapPriority(riskLevel: string, score: number): string {
  const sev = mapSeverity(riskLevel);
  if (sev === "critical") return "critical";
  if (sev === "high" || score < 50) return "high";
  if (sev === "medium" || score < 70) return "medium";
  return "low";
}

function shouldCreateTask(payload: AuditResultPayload): boolean {
  if (payload.issue_type === "audit_pipeline_error") return false;
  const sev = mapSeverity(payload.risk_level);
  return sev === "critical" || sev === "high" || sev === "medium" || payload.score < 70;
}

/**
 * public.agent_audits 保存後に、正規品質台帳へ best-effort で複写する。
 * DATABASE_URL 未設定・エージェント未登録時は静かにスキップ（本番監査は止めない）。
 */
export async function mirrorAuditToQualityLedger(input: {
  auditId: string;
  agentName: string;
  targetLogId?: string | null;
  payload: AuditResultPayload;
}): Promise<{ reviewId?: string; findingId?: string; taskId?: string } | null> {
  const db = tryGetPool();
  if (!db) return null;

  try {
    const agentKey = normalizeAgentKey(input.agentName);
    const agent = await getAgentByKey(db, agentKey);
    if (!agent) {
      logger.warn("quality ledger: agent not found, skip", { agentKey, auditId: input.auditId });
      return null;
    }

    const reviewDate = getJstDateString(new Date());
    const review = await getOrCreateDailyQualityReview(db, {
      reviewDate,
      agentId: agent.id,
      scoreOverall: input.payload.score,
      summary: input.payload.summary.slice(0, 2000),
    });

    const severity = mapSeverity(input.payload.risk_level);
    const findingText = [
      input.payload.summary,
      "",
      `issue_type: ${input.payload.issue_type}`,
      `grade: ${input.payload.grade}`,
      `score: ${input.payload.score}`,
      input.payload.evidence ? `evidence: ${input.payload.evidence.slice(0, 1500)}` : null,
      `rits_audit_id=${input.auditId}`,
      input.targetLogId ? `rits_log_id=${input.targetLogId}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const finding = await createQualityFinding(db, {
      reviewId: review.id,
      agentId: agent.id,
      category: input.payload.issue_type || "quality",
      severity,
      finding: findingText.slice(0, 8000),
      suggestion: input.payload.improvement.slice(0, 4000),
    });

    let taskId: string | undefined;
    if (shouldCreateTask(input.payload)) {
      const dup = await findImprovementTaskByAuditId(db, input.auditId);
      if (!dup) {
        const title = `[${input.agentName}] ${input.payload.issue_type || "quality"} (score ${input.payload.score})`.slice(
          0,
          200
        );
        const task = await createImprovementTask(db, {
          sourceFindingId: finding.id,
          targetAgentId: agent.id,
          title,
          description: [
            input.payload.summary,
            "",
            input.payload.improvement,
            "",
            `rits_audit_id=${input.auditId}`,
            input.targetLogId ? `rits_log_id=${input.targetLogId}` : null,
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 8000),
          cursorInstruction: input.payload.cursor_instruction.slice(0, 8000),
          priority: mapPriority(input.payload.risk_level, input.payload.score),
          status: "draft",
        });
        taskId = task.id;
      } else {
        taskId = dup.id;
      }
    }

    return { reviewId: review.id, findingId: finding.id, taskId };
  } catch (e) {
    logger.warn("quality ledger mirror failed (non-fatal)", {
      err: e instanceof Error ? e.message : String(e),
      auditId: input.auditId,
      agentName: input.agentName,
    });
    return null;
  }
}
