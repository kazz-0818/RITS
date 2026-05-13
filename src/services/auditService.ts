import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import { AuditResultPayloadSchema, type AuditResultPayload } from "../types/audit.js";
import { buildAuditSystemPrompt, buildAuditUserPrompt } from "../prompts/auditPrompt.js";
import * as logService from "./logService.js";
import { generateJson } from "../lib/openai.js";

function trimText(s: string | null | undefined, max: number): string {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…(truncated)`;
}

function buildProfileBlock(profile: {
  agent_name: string;
  role: string;
  allowed_scope: string | null;
  forbidden_scope: string | null;
  evaluation_rules: string | null;
}): string {
  return [
    `- agent_name: ${profile.agent_name}`,
    `- role: ${profile.role}`,
    `- allowed_scope: ${profile.allowed_scope ?? ""}`,
    `- forbidden_scope: ${profile.forbidden_scope ?? ""}`,
    `- evaluation_rules: ${profile.evaluation_rules ?? ""}`,
  ].join("\n");
}

function fallbackAudit(params: {
  agent_name: string;
  logId: string;
  reason: string;
  raw?: string;
}): AuditResultPayload {
  return {
    agent_name: params.agent_name,
    score: 35,
    grade: "D",
    issue_type: "audit_pipeline_error",
    risk_level: "medium",
    summary:
      "監査結果のJSONとしての検証に失敗しました。OpenAI出力形式、または入力ログの形式を確認してください。",
    evidence: `失敗理由: ${params.reason}\n抜粋: ${(params.raw ?? "").slice(0, 1200)}`,
    improvement:
      "auditPromptのJSONキー制約を再確認し、ログ投入量（文字数）を削減してください。必要ならモデルを変更してください。",
    cursor_instruction:
      "`src/prompts/auditPrompt.ts` と `src/services/auditService.ts` を確認し、OpenAIの `response_format=json_object` 出力がスキーマに一致するよう修正してください。完了条件: `npm run typecheck` が通り、手動で `/admin/audit/run` が成功すること。",
  };
}

export async function runAuditForAgent(params: {
  supabase: SupabaseClient;
  openai: OpenAI;
  model: string;
  agent_name: string;
  limit: number;
}): Promise<{ audited: number; audit_ids: string[] }> {
  const profile = await logService.getAgentProfileByName(params.supabase, params.agent_name);
  const profileBlock =
    profile != null
      ? buildProfileBlock(profile)
      : `- agent_name: ${params.agent_name}\n- role: (profile not found in DB)`;

  const logs = await logService.getAgentLogsByName(params.supabase, {
    agent_name: params.agent_name,
    limit: Math.min(Math.max(params.limit, 1), 50),
  });

  const auditIds: string[] = [];

  // 古い順に監査（同日内の流れとして自然）
  const ordered = [...logs].reverse();

  for (const log of ordered) {
    const minimalLog = {
      id: log.id,
      created_at: log.created_at,
      user_message: trimText(log.user_message, 4000),
      agent_reply: trimText(log.agent_reply, 6000),
      intent: log.intent,
      confidence: log.confidence,
      source: log.source,
    };

    const user = buildAuditUserPrompt({
      agentProfile: profileBlock,
      logsJson: JSON.stringify([minimalLog]),
    });

    const json = await generateJson({
      client: params.openai,
      model: params.model,
      system: buildAuditSystemPrompt(),
      user,
      schema: AuditResultPayloadSchema,
    });

    let payload: AuditResultPayload;
    if (!json.ok) {
      await logService.createSystemError(params.supabase, {
        source: "auditService.generateJson",
        error_message: `Audit JSON validation failed (${json.failure.kind}): ${json.failure.message}`,
        stack_trace: json.failure.zodError,
        severity: "high",
        metadata: {
          agent_name: params.agent_name,
          log_id: log.id,
          raw_snippet: json.failure.raw?.slice(0, 4000),
        },
      });
      payload = fallbackAudit({
        agent_name: params.agent_name,
        logId: log.id,
        reason: json.failure.message,
        raw: json.failure.raw,
      });
    } else {
      payload = {
        ...json.data,
        risk_level: json.data.risk_level.trim().toLowerCase(),
      };
      // agent_nameの取り違え防止（モデルが別名を返した場合はログ側を正とする）
      if (payload.agent_name !== params.agent_name) {
        payload = { ...payload, agent_name: params.agent_name };
      }
    }

    const created = await logService.createAudit(params.supabase, {
      agent_name: params.agent_name,
      target_log_id: log.id,
      score: payload.score,
      grade: payload.grade,
      issue_type: payload.issue_type,
      risk_level: payload.risk_level,
      summary: payload.summary,
      evidence: payload.evidence,
      improvement: payload.improvement,
      cursor_instruction: payload.cursor_instruction,
      metadata: { model: params.model },
    });
    auditIds.push(created.id);
  }

  return { audited: auditIds.length, audit_ids: auditIds };
}
