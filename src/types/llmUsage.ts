import { z } from "zod";

export const LlmUsageIngestSchema = z.object({
  agent_name: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  prompt_tokens: z.number().int().min(0),
  completion_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0).optional(),
  source: z.string().min(1).max(128),
  metadata: z.record(z.unknown()).optional(),
});

export type LlmUsageIngest = z.infer<typeof LlmUsageIngestSchema>;

export type LlmUsageEventRow = {
  id: string;
  agent_name: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  source: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type LlmUsageAgentSummary = {
  agent_name: string;
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  share_pct: number;
  top_model: string;
};

export type LlmUsageDailySummary = {
  report_date: string;
  since_iso: string;
  until_iso: string;
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  by_agent: LlmUsageAgentSummary[];
  by_model: Array<{ model: string; total_tokens: number; request_count: number }>;
};
