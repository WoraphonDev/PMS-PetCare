import type { SubscriptionGetResponse } from "@app/contracts";
import type { OrgRequestContext } from "../../../common/context";
import { branchCount, staffSeats } from "../../org";
import { currentSubscription } from "../subscription.repository";

/**
 * docs/spec/features/foundation.md#contract-subscription-get (T-0018-03) — usage uses the counts of the limit rules
 * (#rule-branch-capacity, #rule-staff-capacity). No `note`, no plan `isActive`. No subscription fails closed (INTERNAL).
 */
export async function subscriptionGet(ctx: OrgRequestContext): Promise<SubscriptionGetResponse> {
  return ctx.db.run(async (tx) => {
    const current = await currentSubscription(tx);
    if (!current) throw new Error("subscription.get: the organization has no subscription");
    const { sub, plan } = current;
    return {
      plan: {
        code: plan.code,
        name: plan.name,
        maxBranches: plan.maxBranches,
        maxStaff: plan.maxStaff,
        priceSatangPerMonth: plan.priceSatangPerMonth,
      },
      startedAt: sub.startedAt.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      usage: { branches: await branchCount(tx), staff: await staffSeats(tx, ctx.now) },
    };
  });
}
