import type { plan, subscription, Tx } from "@app/db";

export interface OrgSubscription {
  sub: typeof subscription.$inferSelect;
  plan: typeof plan.$inferSelect;
}

/**
 * Subscriptions with their plans for the platform module (foundation#rule-platform-module): runs on the platform
 * connection (BYPASSRLS), so it filters by org explicitly. Shops without a subscription are absent from the map.
 */
export async function subscriptionsOf(tx: Tx, orgIds: readonly string[]): Promise<Map<string, OrgSubscription>> {
  if (orgIds.length === 0) return new Map();
  const subs = await tx.query.subscription.findMany({ where: (s, { inArray }) => inArray(s.orgId, [...orgIds]) });
  const planIds = [...new Set(subs.map((s) => s.planId))];
  const plans = planIds.length === 0 ? [] : await tx.query.plan.findMany({ where: (p, { inArray }) => inArray(p.id, planIds) });
  const byId = new Map(plans.map((p) => [p.id, p]));
  const found = new Map<string, OrgSubscription>();
  for (const sub of subs) {
    const p = byId.get(sub.planId);
    if (p) found.set(sub.orgId, { sub, plan: p });
  }
  return found;
}

/** #contract-platform-plan-list: every plan, active or not, by code. */
export function listPlans(tx: Tx) {
  return tx.query.plan.findMany({ orderBy: (p, { asc }) => [asc(p.code)] });
}
