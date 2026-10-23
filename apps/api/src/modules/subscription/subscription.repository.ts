import type { Tx } from "@app/db";

// The org's subscription with its plan, on the caller's tenant transaction (RLS = that org; `plan` has no org_id).
export async function currentSubscription(tx: Tx) {
  const sub = await tx.query.subscription.findFirst();
  if (!sub) return undefined;
  const plan = await tx.query.plan.findFirst({ where: (p, { eq }) => eq(p.id, sub.planId) });
  return plan && { sub, plan };
}
