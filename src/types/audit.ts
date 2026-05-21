import { z } from "zod";

export const AuditResultPayloadSchema = z.object({
  agent_name: z.string(),
  score: z.number().int().min(0).max(100),
  grade: z.string(),
  issue_type: z.string(),
  risk_level: z.string(),
  summary: z.string(),
  evidence: z.string(),
  improvement: z.string(),
  cursor_instruction: z.string(),
});

export type AuditResultPayload = z.infer<typeof AuditResultPayloadSchema>;

export const AgentAuditRowSchema = z.object({
  id: z.string().uuid(),
  agent_name: z.string(),
  target_log_id: z.string().uuid().nullable(),
  score: z.number().nullable(),
  grade: z.string().nullable(),
  issue_type: z.string().nullable(),
  risk_level: z.string().nullable(),
  summary: z.string().nullable(),
  evidence: z.string().nullable(),
  improvement: z.string().nullable(),
  cursor_instruction: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});

export type AgentAuditRow = z.infer<typeof AgentAuditRowSchema>;

export const DailyReportRowSchema = z.object({
  id: z.string().uuid(),
  report_date: z.string(),
  summary: z.string().nullable(),
  near_summary: z.string().nullable(),
  sera_summary: z.string().nullable(),
  lira_summary: z.string().nullable(),
  total_score: z.number().nullable(),
  priority_issues: z.string().nullable(),
  cursor_instruction: z.string().nullable(),
  owner_line_pushed_at: z.string().nullable().optional(),
  created_at: z.string(),
});

export type DailyReportRow = z.infer<typeof DailyReportRowSchema>;

export const DailyReportAiPayloadSchema = z.object({
  summary: z.string(),
  near_summary: z.string(),
  sera_summary: z.string(),
  lira_summary: z.string(),
  total_score: z.number().int().min(0).max(100),
  priority_issues: z.string(),
  cursor_instruction: z.string(),
});

export type DailyReportAiPayload = z.infer<typeof DailyReportAiPayloadSchema>;
