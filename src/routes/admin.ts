import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { createOpenAIClient } from "../lib/openai.js";
import { tryCreateSupabaseAdmin } from "../lib/supabase.js";
import { CreateAgentLogInputSchema } from "../types/agent.js";
import * as logService from "../services/logService.js";
import * as auditService from "../services/auditService.js";
import * as reportService from "../services/reportService.js";
import { pushDailyReportToOwner } from "../services/ownerDailyPushService.js";
import { getJstDateString } from "../lib/date.js";
import { LlmUsageIngestSchema } from "../types/llmUsage.js";
import * as llmUsageService from "../services/llmUsageService.js";

export function createAdminApp(env: Env) {
  const app = new Hono();
  const openai = createOpenAIClient(env.OPENAI_API_KEY);

  // ワイルドカード "*" だと /webhook/line まで巻き込むため /admin 配下のみ認証する
  app.use("/admin/*", async (c, next) => {
    const key = c.req.header("x-admin-api-key");
    if (!key || key !== env.ADMIN_API_KEY) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    return await next();
  });

  /** 各エージェント（NEAR/SERA/IRIE/LRAM）からの LLM usage 受信 */
  app.post("/admin/usage", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const body = LlmUsageIngestSchema.parse(await c.req.json());
    const created = await llmUsageService.ingestLlmUsage(supabase, body);
    return c.json({ ok: true, id: created.id });
  });

  app.get("/admin/usage/summary", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const date = c.req.query("date")?.trim() || getJstDateString(new Date());
    const summary = await llmUsageService.getLlmUsageDailySummary(supabase, date);
    return c.json({
      ok: true,
      summary,
      line_preview: llmUsageService.formatLlmUsageForLine(summary),
    });
  });

  app.post("/admin/logs", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const body = CreateAgentLogInputSchema.parse(await c.req.json());
    // Webhook 再送や送信側リトライによる二重記録を防ぐ（冪等）
    const created = await logService.createAgentLogDeduped(supabase, body);
    return c.json({ ok: true, id: created.id, duplicate: created.duplicate });
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

  /** 保存済み日次レポートの取得（生成しない・LLM を使わない）。CORE などの取次ぎ用 */
  app.get("/admin/reports/daily", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const date = c.req.query("date")?.trim() || getJstDateString(new Date());
    const row = await logService.getDailyReportByDate(supabase, date);
    if (!row) return c.json({ ok: false, error: "not_found", report_date: date }, 404);
    const line_preview = await reportService.formatDailyReportForLine(row, { supabase });
    return c.json({ ok: true, report: row, line_preview });
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

  const PushOwnerSchema = z.object({
    force: z.boolean().optional().default(false),
  });

  /** 日次監査を LINE_OWNER_USER_ID へ push（手動・cron 用） */
  app.post("/admin/reports/daily/push-owner", async (c) => {
    const supabase = tryCreateSupabaseAdmin(env);
    if (!supabase) return c.json({ ok: false, error: "supabase_not_configured" }, 503);

    const body = PushOwnerSchema.parse(await c.req.json().catch(() => ({})));
    const result = await pushDailyReportToOwner({
      env,
      supabase,
      openai,
      force: body.force,
    });
    if (!result.ok) return c.json({ ok: false, error: result.error }, 500);
    return c.json(result);
  });

  return app;
}
