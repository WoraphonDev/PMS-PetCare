import { subscription, type TxContext } from "@app/db";

// docs/spec/features/foundation.md#tbl-plan — seeded by the platform (Q-0005); this module only reads it.
const FREE_PLAN_CODE = "mvp_free";

export interface FreeSubscriptionResult {
  subscriptionId: string;
  planId: string;
}

/**
 * Attaches the seeded active `mvp_free` plan to `orgId` on the caller's transaction
 * (foundation#rule-signup-atomic): `current_period_end` is null because the MVP plan never expires.
 *
 * The plan catalogue is read-only here — a missing or inactive `mvp_free` plan fails closed instead of
 * seeding or repairing it. `now` comes from the injected clock, never from the database.
 */
export async function startFreeSubscription(ctx: TxContext, orgId: string, now: Date): Promise<FreeSubscriptionResult> {
  if (orgId !== ctx.orgId) {
    throw new Error("startFreeSubscription: orgId does not match the transaction context");
  }

  const free = await ctx.tx.query.plan.findFirst({
    columns: { id: true },
    where: (p, { and, eq }) => and(eq(p.code, FREE_PLAN_CODE), eq(p.isActive, true)),
  });
  if (!free) throw new Error(`startFreeSubscription: no active ${FREE_PLAN_CODE} plan is seeded`);

  const [created] = await ctx.tx
    .insert(subscription)
    .values({ orgId, planId: free.id, startedAt: now, currentPeriodEnd: null })
    .returning({ id: subscription.id });
  if (!created) throw new Error("startFreeSubscription: the subscription insert returned no row");

  return { subscriptionId: created.id, planId: free.id };
}
