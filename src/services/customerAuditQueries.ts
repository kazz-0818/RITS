import type { Db } from "../db/client.js";
import { listIdentitiesForCustomer } from "./supabase/repositories/customerIdentities.js";
import { listCustomerProfiles } from "./supabase/repositories/customerProfiles.js";
import { listCustomerMemoryNotes } from "./supabase/repositories/customerMemoryNotes.js";
import { listAgentContextsForCustomer } from "./supabase/repositories/customerAgentContexts.js";
import { listConversationIdsForCustomer } from "./supabase/repositories/customerConversationLinks.js";
import { getCustomerById } from "./supabase/repositories/customers.js";
import { listMergeCandidates } from "./supabase/repositories/customerMergeCandidates.js";

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

/** 日次レポート用（読取のみ・自動 merge なし） */
export async function buildCustomerMasterAuditSection(db: Db): Promise<string> {
  const lines: string[] = ["## Veriora_customer_master"];
  try {
    const pending = await listMergeCandidates(db, "pending");
    lines.push(`merge_candidates_pending: ${pending.length}`);
    for (const c of pending.slice(0, 5)) {
      lines.push(
        `- ${c.id.slice(0, 8)}… reason=${c.reason ?? "?"} score=${c.score ?? "?"}`,
      );
    }
    const active = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM veriora.customers WHERE status = 'active'`,
    );
    lines.push(`customers_active: ${active.rows[0]?.n ?? "?"}`);
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
