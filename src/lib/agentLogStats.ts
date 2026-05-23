import type { AgentLogRow } from "../types/agent.js";

export type AgentLogKindSplit = {
  total: number;
  lineReplies: number;
  groupObserve: number;
  other: number;
};

/** 日次・稼働報告用: 応答ログとグループ傍受を分離 */
export function splitAgentLogsByKind(logs: AgentLogRow[]): AgentLogKindSplit {
  let lineReplies = 0;
  let groupObserve = 0;
  let other = 0;
  for (const log of logs) {
    if (log.intent === "group_observe") {
      groupObserve++;
      continue;
    }
    if ((log.agent_reply?.trim() ?? "").length > 0) {
      lineReplies++;
      continue;
    }
    other++;
  }
  return { total: logs.length, lineReplies, groupObserve, other };
}

export function formatAgentLogKindSuffix(split: AgentLogKindSplit): string {
  if (split.total === 0) return "0件";
  const parts: string[] = [`${split.total}件`];
  const detail: string[] = [];
  if (split.lineReplies > 0) detail.push(`応答${split.lineReplies}`);
  if (split.groupObserve > 0) detail.push(`グループ傍受${split.groupObserve}`);
  if (split.other > 0) detail.push(`その他${split.other}`);
  if (detail.length > 0) parts.push(`（${detail.join("・")}）`);
  return parts.join("");
}
