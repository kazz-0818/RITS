import { z } from "zod";

export type AgentName = "NEAR" | "SERA" | "LIRA" | "RITS";

export const AgentProfileSchema = z.object({
  id: z.string().uuid(),
  agent_name: z.string(),
  display_name: z.string().nullable(),
  role: z.string(),
  allowed_scope: z.string().nullable(),
  forbidden_scope: z.string().nullable(),
  tone: z.string().nullable(),
  evaluation_rules: z.string().nullable(),
  is_active: z.boolean().nullable(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const CreateAgentLogInputSchema = z.object({
  agent_name: z.string().min(1),
  user_message: z.string().optional().nullable(),
  agent_reply: z.string().optional().nullable(),
  intent: z.string().optional().nullable(),
  confidence: z.number().optional().nullable(),
  source: z.string().optional().default("line"),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type CreateAgentLogInput = z.infer<typeof CreateAgentLogInputSchema>;

export const AgentLogRowSchema = z.object({
  id: z.string().uuid(),
  agent_name: z.string(),
  user_message: z.string().nullable(),
  agent_reply: z.string().nullable(),
  intent: z.string().nullable(),
  confidence: z.union([z.string(), z.number()]).nullable(), // numeric from PG may come as string
  source: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});

export type AgentLogRow = z.infer<typeof AgentLogRowSchema>;
