import type { Db } from "../db/client.js";
import { tryGetPool } from "../db/client.js";
import { getJstDateString } from "../lib/date.js";
import { logger } from "../lib/logger.js";
import { listMergeCandidates } from "./supabase/repositories/customerMergeCandidates.js";
import { getAgentByKey } from "./supabase/repositories/agents.js";
import {
  createImprovementTask,
  createQualityFinding,
  findRecentFindingByMarker,
  getOrCreateDailyQualityReview,
} from "./supabase/repositories/qualityReviews.js";

const SENSITIVE_PATTERN =
  /健康|病気|宗教|政治|性的|犯罪|人種|民族|労働組合|住所|マンション番号|丁目|番地\d/i;

type SafetyCandidate = {
  marker: string;
  category: string;
  severity: string;
  finding: string;
  suggestion: string;
  createTask: boolean;
  priority: string;
  title: string;
};

async function collectSafetyCandidates(db: Db): Promise<SafetyCandidate[]> {
  const out: SafetyCandidate[] = [];

  const pending = await listMergeCandidates(db, "pending");
  for (const c of pending.slice(0, 10)) {
    out.push({
      marker: `customer_safety_key=merge:${c.id}`,
      category: "customer_merge_candidate",
      severity: "medium",
      finding: [
        "顧客 identity merge 候補が未処理です。",
        `merge_candidate_id=${c.id}`,
        `A=${c.customer_id_a} B=${c.customer_id_b}`,
        `reason=${c.reason ?? "?"}`,
        `customer_safety_key=merge:${c.id}`,
      ].join("\n"),
      suggestion: "NEAR 管理 UI で merge 候補を確認し、承認または却下してください（RITS は読取のみ）。",
      createTask: true,
      priority: "medium",
      title: `[customer] merge候補 ${c.id.slice(0, 8)}`,
    });
  }

  const unconfirmed = await db.query<{ id: string; note: string; category: string | null }>(
    `SELECT id, note, category FROM veliora.customer_memory_notes
     WHERE confirmed = false ORDER BY created_at DESC LIMIT 10`
  );
  for (const row of unconfirmed.rows) {
    out.push({
      marker: `customer_safety_key=unconfirmed_note:${row.id}`,
      category: "customer_unconfirmed_note",
      severity: "low",
      finding: [
        "未確認の顧客メモがあります。断定回答に使う前に確認が必要です。",
        `[${row.category ?? "?"}] ${row.note.slice(0, 400)}`,
        `customer_safety_key=unconfirmed_note:${row.id}`,
      ].join("\n"),
      suggestion: "メモを確認して confirmed にするか、エージェントに未確認情報の断定を禁止してください。",
      createTask: false,
      priority: "low",
      title: `[customer] 未確認メモ ${row.id.slice(0, 8)}`,
    });
  }

  const notes = await db.query<{ id: string; note: string }>(
    `SELECT id, note FROM veliora.customer_memory_notes ORDER BY created_at DESC LIMIT 60`
  );
  for (const row of notes.rows.filter((r) => SENSITIVE_PATTERN.test(r.note)).slice(0, 5)) {
    out.push({
      marker: `customer_safety_key=sensitive_note:${row.id}`,
      category: "customer_sensitive_note",
      severity: "high",
      finding: [
        "センシティブ候補の顧客メモです。自動利用・外部送信を避けて人手レビューしてください。",
        row.note.slice(0, 200),
        `customer_safety_key=sensitive_note:${row.id}`,
      ].join("\n"),
      suggestion: "メモの保持要否を確認し、不要なら削除・マスキング方針を各部署へ周知してください。",
      createTask: true,
      priority: "high",
      title: `[customer] センシティブメモ ${row.id.slice(0, 8)}`,
    });
  }

  const cross = await db.query<{ customer_id: string }>(
    `SELECT n.customer_id FROM veliora.customer_memory_notes n
     WHERE n.confirmed = true AND n.source_agent_key = 'sera'
     GROUP BY n.customer_id
     HAVING COUNT(*) > 0
     AND NOT EXISTS (
       SELECT 1 FROM veliora.customer_agent_contexts ac
       WHERE ac.customer_id = n.customer_id AND ac.agent_key = 'near'
         AND ac.context_summary IS NOT NULL AND length(btrim(ac.context_summary)) > 20
     )
     LIMIT 5`
  );
  for (const row of cross.rows) {
    out.push({
      marker: `customer_safety_key=context_gap:${row.customer_id}`,
      category: "customer_context_gap",
      severity: "medium",
      finding: [
        "SERA に確定メモがあるが NEAR の agent context が薄い顧客です。部署間コンテキスト欠落の疑い。",
        `customer_id=${row.customer_id}`,
        `customer_safety_key=context_gap:${row.customer_id}`,
      ].join("\n"),
      suggestion: "NEAR の顧客コンテキスト同期、または handoff 時の要約引き渡しを確認してください。",
      createTask: true,
      priority: "medium",
      title: `[customer] コンテキスト欠落 ${row.customer_id.slice(0, 8)}`,
    });
  }

  return out;
}

/**
 * 顧客横断セーフティ監査結果を品質台帳の finding / draft task に落とす。
 * 日次バッチ向け。重複は marker + 7日で抑制。
 */
export async function syncCustomerSafetyFindingsToLedger(): Promise<{
  candidates: number;
  findingsCreated: number;
  tasksCreated: number;
}> {
  const db = tryGetPool();
  if (!db) return { candidates: 0, findingsCreated: 0, tasksCreated: 0 };

  try {
    const rits = await getAgentByKey(db, "rits");
    if (!rits) {
      logger.warn("customer safety ledger: rits agent not found");
      return { candidates: 0, findingsCreated: 0, tasksCreated: 0 };
    }

    const candidates = await collectSafetyCandidates(db);
    const reviewDate = getJstDateString(new Date());
    const review = await getOrCreateDailyQualityReview(db, {
      reviewDate,
      agentId: rits.id,
      summary: `customer safety sync (${candidates.length} candidates)`,
    });

    let findingsCreated = 0;
    let tasksCreated = 0;

    for (const c of candidates) {
      const dup = await findRecentFindingByMarker(db, c.marker, 7);
      if (dup) continue;

      const finding = await createQualityFinding(db, {
        reviewId: review.id,
        agentId: rits.id,
        category: c.category,
        severity: c.severity,
        finding: c.finding.slice(0, 8000),
        suggestion: c.suggestion.slice(0, 4000),
      });
      findingsCreated += 1;

      if (c.createTask) {
        await createImprovementTask(db, {
          sourceFindingId: finding.id,
          targetAgentId: rits.id,
          title: c.title.slice(0, 200),
          description: `${c.finding}\n\n${c.suggestion}`.slice(0, 8000),
          cursorInstruction: c.suggestion.slice(0, 4000),
          priority: c.priority,
          status: "draft",
        });
        tasksCreated += 1;
      }
    }

    return { candidates: candidates.length, findingsCreated, tasksCreated };
  } catch (e) {
    logger.warn("syncCustomerSafetyFindingsToLedger failed (non-fatal)", {
      err: e instanceof Error ? e.message : String(e),
    });
    return { candidates: 0, findingsCreated: 0, tasksCreated: 0 };
  }
}
