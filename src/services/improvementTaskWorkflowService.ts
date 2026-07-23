import { tryGetPool } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { getAgentByKey } from "./supabase/repositories/agents.js";
import {
  getImprovementTaskByIdPrefix,
  listAwaitingReauditTasksForAgent,
  updateImprovementTaskStatus,
  type ImprovementTaskRow,
} from "./supabase/repositories/qualityReviews.js";
import { saveHandoffLog } from "./supabase/repositories/routingLogs.js";

export type TaskWorkflowAction = "approve" | "reject" | "distribute" | "mark_implemented";

const ALLOWED: Record<TaskWorkflowAction, string[]> = {
  approve: ["draft", "pending_approval"],
  reject: ["draft", "pending_approval", "approved"],
  distribute: ["approved", "draft", "pending_approval"],
  mark_implemented: ["distributed", "approved"],
};

const NEXT_STATUS: Record<TaskWorkflowAction, string> = {
  approve: "approved",
  reject: "rejected",
  distribute: "distributed",
  mark_implemented: "awaiting_reaudit",
};

export async function applyImprovementTaskAction(params: {
  idPrefix: string;
  action: TaskWorkflowAction;
}): Promise<{ ok: true; task: ImprovementTaskRow } | { ok: false; message: string }> {
  const db = tryGetPool();
  if (!db) {
    return { ok: false, message: "DATABASE_URL が未設定のため品質台帳を更新できません。" };
  }

  const task = await getImprovementTaskByIdPrefix(db, params.idPrefix);
  if (!task) {
    return {
      ok: false,
      message: `タスクが見つかりません（ID先頭: ${params.idPrefix}）。「未承認タスク」で一覧を確認してください。`,
    };
  }

  const allowed = ALLOWED[params.action];
  if (!allowed.includes(task.status)) {
    return {
      ok: false,
      message: `状態 ${task.status} のタスクには「${params.action}」できません（許可: ${allowed.join(", ")}）。`,
    };
  }

  const note = `[workflow ${params.action} @ ${new Date().toISOString()}]`;
  const updated = await updateImprovementTaskStatus(db, {
    taskId: task.id,
    status: NEXT_STATUS[params.action],
    appendDescription: note,
  });
  if (!updated) {
    return { ok: false, message: "ステータス更新に失敗しました。" };
  }

  if (params.action === "distribute") {
    try {
      const rits = await getAgentByKey(db, "rits");
      const targetKey = (updated.target_agent_key ?? "near").toLowerCase();
      const target = await getAgentByKey(db, targetKey);
      if (rits && target) {
        await saveHandoffLog(db, {
          fromAgentId: rits.id,
          toAgentId: target.id,
          handoffReason: "rits_improvement_task_distribute",
          summary: [
            updated.title,
            updated.cursor_instruction ?? "",
            `task_id=${updated.id}`,
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 4000),
        });
      }
    } catch (e) {
      logger.warn("handoff log on distribute failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
        taskId: updated.id,
      });
    }
  }

  return { ok: true, task: updated };
}

/** 再監査でスコアが改善したら awaiting_reaudit を closed にする */
export async function tryCloseTasksAfterReaudit(params: {
  agentName: string;
  score: number;
  auditId: string;
}): Promise<number> {
  if (params.score < 70) return 0;
  const db = tryGetPool();
  if (!db) return 0;

  try {
    const agentKey = params.agentName.trim().toLowerCase();
    const agent = await getAgentByKey(db, agentKey);
    if (!agent) return 0;

    const pending = await listAwaitingReauditTasksForAgent(db, agent.id, 10);
    let closed = 0;
    for (const t of pending) {
      const ok = await updateImprovementTaskStatus(db, {
        taskId: t.id,
        status: "closed",
        appendDescription: `[reaudit closed score=${params.score} rits_audit_id=${params.auditId} @ ${new Date().toISOString()}]`,
      });
      if (ok) closed += 1;
    }
    return closed;
  } catch (e) {
    logger.warn("tryCloseTasksAfterReaudit failed (non-fatal)", {
      err: e instanceof Error ? e.message : String(e),
      agentName: params.agentName,
    });
    return 0;
  }
}
