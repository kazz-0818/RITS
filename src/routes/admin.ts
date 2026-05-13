import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { CreateAgentLogInputSchema } from "../types/agent.js";
import * as logService from "../services/logService.js";
import * as auditService from "../services/auditService.js";
import * as reportService from "../services/reportService.js";
import { getJstDateString } from "../lib/date.js";

export function createAdminApp(env: Env) {
  const app = new Hono();
  const openai = createOpenAIClient(env.OPENAI_API_KEY);

  app.use("*", async (c, next) => {
    const key = c.req.header("x-admin-api-key");
    if (!key || key !== env.ADMIN_API_KEY) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    return await next();
  });

  app.post("/admin/logs", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const body = CreateAgentLogInputSchema.parse(await c.req.json());
    const created = await logService.createAgentLog(supabase, body);
    return c.json({ ok: true, id: created.id });
  });

  const AuditRunSchema = z.object({
    agent_name: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional().default(20),
  });

  app.post("/admin/audit/run", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const body = AuditRunSchema.parse(await c.req.json());
    const res = await auditService.runAuditForAgent({
      supabase,
      openai,
      model: env.OPENAI_MODEL,
      agent_name: body.agent_name,
      limit: body.limit,
    });
    return c.json({ ok: true, ...res });
  });

  app.post("/admin/reports/daily", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    void (await c.req.json().catch(() => ({})));
    const reportDate = getJstDateString(new Date());
    const created = await reportService.generateAndStoreDailyReport({
      supabase,
      openai,
      model: env.OPENAI_MODEL,
      reportDate,
    });
    return c.json({ ok: true, report_date: reportDate, id: created.id });
  });

  return app;
}
