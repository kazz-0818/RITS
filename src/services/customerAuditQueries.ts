import type { Db } from "../db/client.js";
import { listIdentitiesForCustomer } from "./supabase/repositories/customerIdentities.js";
import { listCustomerProfiles } from "./supabase/repositories/customerProfiles.js";
import { listCustomerMemoryNotes } from "./supabase/repositories/customerMemoryNotes.js";
import { listAgentContextsForCustomer } from "./supabase/repositories/customerAgentContexts.js";
import { listConversationIdsForCustomer } from "./supabase/repositories/customerConversationLinks.js";
import { getCustomerById } from "./supabase/repositories/customers.js";
import { listMergeCandidates } from "./supabase/repositories/customerMergeCandidates.js";

const SENSITIVE_PATTERN =
  /健康|病気|宗教|政治|性的|犯罪|人種|民族|労働組合|住所|マンション番号|丁目|番地\d/i;

export type CustomerAuditBundle = {
  customer: Awaited<ReturnType<typeof getCustomerById>>;
  identities: Awaited<ReturnType<typeof listIdentitiesForCustomer>>;
  profiles: Awaited<ReturnType<typeof listCustomerProfiles>>;
  notes: Awaited<ReturnType<typeof listCustomerMemoryNotes>>;
  agentContexts: Awaited<ReturnType<typeof listAgentContextsForCustomer>>;
  conversationIds: string[];
  unconfirmedProfileCount: number;
};

export async function loadCustomerAuditBundle(
  db: Db,
  customerId: string
): Promise<CustomerAuditBundle | null> {
  const customer = await getCustomerById(db, customerId);
  if (!customer) return null;

  const [identities, profiles, notes, agentContexts, conversationIds] = await Promise.all([
    listIdentitiesForCustomer(db, customerId),
    listCustomerProfiles(db, customerId, { limit: 50 }),
    listCustomerMemoryNotes(db, customerId, { limit: 30 }),
    listAgentContextsForCustomer(db, customerId),
    listConversationIdsForCustomer(db, customerId),
  ]);

  return {
    customer,
    identities,
    profiles,
    notes,
    agentContexts,
    conversationIds,
    unconfirmedProfileCount: profiles.filter((p) => !p.confirmed).length,
  };
}

/** 日次レポート用（読取のみ・merge/削除は行わない） */
export async function buildCustomerMasterAuditSection(db: Db): Promise<string> {
  const lines: string[] = ["## Veriora_customer_master_audit"];
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  lines.push(`window_start_utc: ${since24h}`);

  try {
    const active = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM veriora.customers WHERE status = 'active'`,
    );
    const new24h = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM veriora.customers
       WHERE status = 'active' AND created_at >= $1::timestamptz`,
      [since24h],
    );
    lines.push(`customers_active: ${active.rows[0]?.n ?? "?"}`);
    lines.push(`customers_new_24h: ${new24h.rows[0]?.n ?? "?"}`);

    const pending = await listMergeCandidates(db, "pending");
    lines.push(`merge_candidates_pending: ${pending.length}`);
    if (pending.length > 0) {
      const nearUi =
        (process.env.VERIORA_NEAR_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "")
          .trim()
          .replace(/\/$/, "") || "";
      lines.push(
        `merge_admin_ui: ${nearUi ? `${nearUi}/admin/ui` : "NEAR /admin/ui（PUBLIC_BASE_URL 未設定）"}`,
      );
    }
    for (const c of pending.slice(0, 8)) {
      lines.push(
        `  - pending ${c.id.slice(0, 8)}… A=${c.customer_id_a.slice(0, 8)} B=${c.customer_id_b.slice(0, 8)} reason=${c.reason ?? "?"}`,
      );
    }

    const mem = await db.query<{ confirmed: boolean; n: string }>(
      `SELECT confirmed, COUNT(*)::text AS n FROM veriora.customer_memory_notes GROUP BY confirmed`,
    );
    for (const row of mem.rows) {
      lines.push(`memory_${row.confirmed ? "confirmed" : "unconfirmed"}: ${row.n}`);
    }

    const agentMsgs = await db.query<{ agent_key: string; n: string }>(
      `SELECT a.agent_key, COUNT(*)::text AS n
       FROM veriora.messages m
       JOIN veriora.ai_agents a ON a.id = m.agent_id
       WHERE m.created_at >= $1::timestamptz
       GROUP BY a.agent_key ORDER BY COUNT(*) DESC`,
      [since24h],
    );
    lines.push("agent_message_counts_24h:");
    for (const row of agentMsgs.rows) {
      lines.push(`  - ${row.agent_key}: ${row.n}`);
    }

    const multi = await db.query<{ customer_id: string; n: string }>(
      `SELECT l.customer_id, COUNT(DISTINCT COALESCE(l.agent_key, a.agent_key))::text AS n
       FROM veriora.customer_conversation_links l
       JOIN veriora.conversations c ON c.id = l.conversation_id
       JOIN veriora.ai_agents a ON a.id = c.agent_id
       WHERE c.last_message_at >= $1::timestamptz
       GROUP BY l.customer_id HAVING COUNT(DISTINCT COALESCE(l.agent_key, a.agent_key)) > 1
       ORDER BY COUNT(DISTINCT COALESCE(l.agent_key, a.agent_key)) DESC LIMIT 10`,
      [since24h],
    );
    lines.push(`multi_agent_customers_24h: ${multi.rows.length}`);
    for (const row of multi.rows) {
      lines.push(`  - customer ${row.customer_id.slice(0, 8)}… agents=${row.n}`);
    }

    const needsReview = await db.query<{ id: string; note: string; category: string | null }>(
      `SELECT id, note, category FROM veriora.customer_memory_notes
       WHERE confirmed = false ORDER BY created_at DESC LIMIT 10`,
    );
    lines.push("needs_review_notes:");
    for (const row of needsReview.rows) {
      lines.push(`  - [${row.category ?? "?"}] ${row.note.slice(0, 100)}`);
    }

    const allNotes = await db.query<{ id: string; note: string }>(
      `SELECT id, note FROM veriora.customer_memory_notes ORDER BY created_at DESC LIMIT 60`,
    );
    const sensitive = allNotes.rows.filter((r) => SENSITIVE_PATTERN.test(r.note)).slice(0, 5);
    lines.push(`sensitive_note_candidates: ${sensitive.length}`);
    for (const row of sensitive) {
      lines.push(`  - (要確認・自動保存は推奨しない) ${row.note.slice(0, 80)}`);
    }

    const nameMismatch = await db.query<{ customer_id: string; preferred_name: string | null }>(
      `SELECT c.id AS customer_id, c.preferred_name
       FROM veriora.customers c
       JOIN veriora.customer_identities ci ON ci.customer_id = c.id
       WHERE c.status = 'active' AND c.preferred_name IS NOT NULL AND btrim(c.preferred_name) <> ''
       GROUP BY c.id, c.preferred_name
       HAVING NOT bool_or(btrim(ci.external_display_name) ILIKE '%' || btrim(c.preferred_name) || '%')
       LIMIT 5`,
    );
    lines.push(`preferred_name_not_in_identities: ${nameMismatch.rows.length}`);
    for (const row of nameMismatch.rows) {
      lines.push(`  - customer ${row.customer_id.slice(0, 8)}… preferred=${row.preferred_name}`);
    }

    const cross = await db.query<{ customer_id: string }>(
      `SELECT n.customer_id FROM veriora.customer_memory_notes n
       WHERE n.confirmed = true AND n.source_agent_key = 'sera'
       GROUP BY n.customer_id
       HAVING COUNT(*) > 0
       AND NOT EXISTS (
         SELECT 1 FROM veriora.customer_agent_contexts ac
         WHERE ac.customer_id = n.customer_id AND ac.agent_key = 'near'
           AND ac.context_summary IS NOT NULL AND length(btrim(ac.context_summary)) > 20
       )
       LIMIT 5`,
    );
    lines.push(`sera_memory_but_near_context_thin: ${cross.rows.length}`);
    for (const row of cross.rows) {
      lines.push(`  - customer ${row.customer_id.slice(0, 8)}… (NEARが他agent情報を未活用の疑い)`);
    }

    lines.push("rits_policy: read_only — no merge, no delete, suggestions only");
  } catch (e) {
    lines.push(`error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return lines.join("\n");
}

export function summarizeCustomerAuditForReport(bundle: CustomerAuditBundle): string {
  const lines: string[] = [];
  lines.push(`顧客 ${bundle.customer?.id?.slice(0, 8) ?? "?"} …`);
  lines.push(`identity数: ${bundle.identities.length}`);
  lines.push(`会話リンク: ${bundle.conversationIds.length}`);
  lines.push(`未確認プロフィール: ${bundle.unconfirmedProfileCount}`);
  for (const ctx of bundle.agentContexts.slice(0, 5)) {
    if (ctx.context_summary?.trim()) {
      lines.push(`- ${ctx.agent_key}: ${ctx.context_summary.trim().slice(0, 120)}`);
    }
  }
  return lines.join("\n");
}
