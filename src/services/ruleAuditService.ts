import { tryGetPool } from "../db/client.js";
import { getJstDateString } from "../lib/date.js";
import { logger } from "../lib/logger.js";
import { getAgentByKey } from "./supabase/repositories/agents.js";
import {
  countHandoffsSince,
  countRoutingSince,
  listMessageFeedSince,
} from "./supabase/repositories/messageFeed.js";
import {
  createImprovementTask,
  createQualityFinding,
  findRecentFindingByMarker,
  getOrCreateDailyQualityReview,
} from "./supabase/repositories/qualityReviews.js";

const TARGET_KEYS = ["near", "sera", "irie", "lram"] as const;

type RuleHit = {
  marker: string;
  agentKey: string;
  category: string;
  severity: string;
  finding: string;
  suggestion: string;
  createTask: boolean;
  priority: string;
  title: string;
};

async function collectRuleHits(sinceIso: string): Promise<RuleHit[]> {
  const db = tryGetPool();
  if (!db) return [];

  const hits: RuleHit[] = [];
  const feed = await listMessageFeedSince(db, {
    sinceIso,
    agentKeys: [...TARGET_KEYS],
    limit: 1000,
  });

  // 無応答: inbound のあとに同一会話・同一 agent の outbound が無い
  const byConv = new Map<string, typeof feed>();
  for (const row of feed) {
    const list = byConv.get(row.conversation_id) ?? [];
    list.push(row);
    byConv.set(row.conversation_id, list);
  }

  const noReplyByAgent = new Map<string, number>();
  for (const [, msgs] of byConv) {
    const ordered = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < ordered.length; i++) {
      const inbound = ordered[i];
      if (!inbound) continue;
      if (inbound.direction !== "inbound" && inbound.role !== "user") continue;
      if (!(inbound.text ?? "").trim()) continue;
      let hasReply = false;
      for (let j = i + 1; j < ordered.length; j++) {
        const cand = ordered[j];
        if (!cand) continue;
        if (cand.agent_key !== inbound.agent_key) continue;
        if (cand.direction === "outbound" || cand.role === "assistant") {
          hasReply = true;
          break;
        }
        if (cand.direction === "inbound" || cand.role === "user") break;
      }
      if (!hasReply) {
        const k = inbound.agent_key.toLowerCase();
        noReplyByAgent.set(k, (noReplyByAgent.get(k) ?? 0) + 1);
      }
    }
  }

  for (const [agentKey, n] of noReplyByAgent) {
    if (n < 1) continue;
    const severity = n >= 5 ? "high" : n >= 2 ? "medium" : "low";
    hits.push({
      marker: `rule_key=no_reply:${agentKey}:${getJstDateString()}`,
      agentKey,
      category: "rule_no_reply",
      severity,
      finding: [
        `決定的ルール: 直近24hで無応答（inbound に対する outbound なし）が ${n} 件。`,
        `agent=${agentKey}`,
        `rule_key=no_reply:${agentKey}:${getJstDateString()}`,
      ].join("\n"),
      suggestion:
        "Webhook 失敗・タイムアウト・グループ傍受のみか確認。必要なら返信経路とエラーログを点検してください。",
      createTask: n >= 2,
      priority: severity === "high" ? "high" : "medium",
      title: `[rule] ${agentKey.toUpperCase()} 無応答 ${n}件`,
    });
  }

  const handoffs = await countHandoffsSince(db, sinceIso);
  const handoffTotal = handoffs.reduce((s, r) => s + (Number.parseInt(r.n, 10) || 0), 0);
  const routing = await countRoutingSince(db, sinceIso);

  // routing が多く handoff がゼロのときは転送未完了の疑い（閾値は控えめ）
  if (routing.n >= 10 && handoffTotal === 0) {
    hits.push({
      marker: `rule_key=handoff_gap:${getJstDateString()}`,
      agentKey: "near",
      category: "rule_handoff_gap",
      severity: "medium",
      finding: [
        `決定的ルール: 直近24hの routing=${routing.n} に対し handoff=0。転送が記録されていない可能性。`,
        `rule_key=handoff_gap:${getJstDateString()}`,
      ].join("\n"),
      suggestion: "routing / handoff の書込経路と、部署間引き渡しの完了条件を確認してください。",
      createTask: true,
      priority: "medium",
      title: "[rule] handoff 未記録の疑い",
    });
  }

  return hits;
}

/**
 * LLM に依存しない決定的ルール監査 → 品質台帳へ finding / draft task。
 */
export async function runDeterministicRuleAudit(params: {
  sinceIso: string;
}): Promise<{ hits: number; findingsCreated: number; tasksCreated: number }> {
  const db = tryGetPool();
  if (!db) return { hits: 0, findingsCreated: 0, tasksCreated: 0 };

  try {
    const hits = await collectRuleHits(params.sinceIso);
    let findingsCreated = 0;
    let tasksCreated = 0;
    const reviewDate = getJstDateString(new Date());

    for (const hit of hits) {
      const dup = await findRecentFindingByMarker(db, hit.marker, 1);
      if (dup) continue;

      const agent = await getAgentByKey(db, hit.agentKey);
      if (!agent) continue;

      const review = await getOrCreateDailyQualityReview(db, {
        reviewDate,
        agentId: agent.id,
        summary: `rule audit: ${hit.category}`,
      });

      const finding = await createQualityFinding(db, {
        reviewId: review.id,
        agentId: agent.id,
        category: hit.category,
        severity: hit.severity,
        finding: hit.finding.slice(0, 8000),
        suggestion: hit.suggestion.slice(0, 4000),
      });
      findingsCreated += 1;

      if (hit.createTask) {
        await createImprovementTask(db, {
          sourceFindingId: finding.id,
          targetAgentId: agent.id,
          title: hit.title.slice(0, 200),
          description: `${hit.finding}\n\n${hit.suggestion}`.slice(0, 8000),
          cursorInstruction: hit.suggestion.slice(0, 4000),
          priority: hit.priority,
          status: "draft",
        });
        tasksCreated += 1;
      }
    }

    return { hits: hits.length, findingsCreated, tasksCreated };
  } catch (e) {
    logger.warn("runDeterministicRuleAudit failed (non-fatal)", {
      err: e instanceof Error ? e.message : String(e),
    });
    return { hits: 0, findingsCreated: 0, tasksCreated: 0 };
  }
}
