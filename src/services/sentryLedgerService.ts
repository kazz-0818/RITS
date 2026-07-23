import { tryGetPool } from "../db/client.js";
import { getJstDateString } from "../lib/date.js";
import { logger } from "../lib/logger.js";
import { getAgentByKey } from "./supabase/repositories/agents.js";
import {
  createImprovementTask,
  createQualityFinding,
  findRecentFindingByMarker,
  getOrCreateDailyQualityReview,
} from "./supabase/repositories/qualityReviews.js";
import { fetchSentryUnresolvedIssues } from "./externalEvidenceService.js";

/**
 * Sentry の頻出未解決 issue を品質台帳の finding / draft に落とす（任意設定時のみ）。
 */
export async function syncSentryIssuesToQualityLedger(): Promise<{
  configured: boolean;
  findingsCreated: number;
  tasksCreated: number;
}> {
  const fetched = await fetchSentryUnresolvedIssues(10);
  if (!fetched.configured) return { configured: false, findingsCreated: 0, tasksCreated: 0 };

  const db = tryGetPool();
  if (!db) return { configured: true, findingsCreated: 0, tasksCreated: 0 };

  try {
    const rits = await getAgentByKey(db, "rits");
    if (!rits) return { configured: true, findingsCreated: 0, tasksCreated: 0 };

    const review = await getOrCreateDailyQualityReview(db, {
      reviewDate: getJstDateString(new Date()),
      agentId: rits.id,
      summary: "sentry unresolved sync",
    });

    let findingsCreated = 0;
    let tasksCreated = 0;

    for (const issue of fetched.issues) {
      const count = Number.parseInt(issue.count, 10) || 0;
      if (count < 3 && issue.level !== "fatal" && issue.level !== "error") continue;

      const marker = `sentry_issue_key=${issue.id}`;
      const dup = await findRecentFindingByMarker(db, marker, 3);
      if (dup) continue;

      const finding = await createQualityFinding(db, {
        reviewId: review.id,
        agentId: rits.id,
        category: "sentry_unresolved",
        severity: issue.level === "fatal" || count >= 50 ? "high" : "medium",
        finding: [
          `Sentry 未解決: ${issue.shortId}`,
          issue.title,
          `count=${issue.count} users=${issue.userCount} level=${issue.level}`,
          `lastSeen=${issue.lastSeen}`,
          issue.permalink,
          marker,
        ].join("\n"),
        suggestion: "例外の再現条件・直近デプロイ・関連 PR を確認し、修正タスク化してください。",
      });
      findingsCreated += 1;

      if (count >= 10 || issue.level === "fatal") {
        await createImprovementTask(db, {
          sourceFindingId: finding.id,
          targetAgentId: rits.id,
          title: `[sentry] ${issue.shortId} ${issue.title}`.slice(0, 200),
          description: `${issue.title}\n${issue.permalink}\n${marker}`,
          cursorInstruction: `Sentry ${issue.shortId} を調査し、根本原因を修正する。完了条件: 再現しないこと、または issue を resolve。`,
          priority: count >= 50 || issue.level === "fatal" ? "high" : "medium",
          status: "draft",
        });
        tasksCreated += 1;
      }
    }

    return { configured: true, findingsCreated, tasksCreated };
  } catch (e) {
    logger.warn("syncSentryIssuesToQualityLedger failed (non-fatal)", {
      err: e instanceof Error ? e.message : String(e),
    });
    return { configured: true, findingsCreated: 0, tasksCreated: 0 };
  }
}
