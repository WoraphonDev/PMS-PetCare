import type { TxContext } from "@app/db";
import { lockPlanLimits } from "./plan-lock";

/**
 * docs/spec/features/foundation.md#rule-branch-capacity — locks the organization's subscription row
 * (`FOR UPDATE`) on the caller's tenant transaction and returns its plan's `max_branches` (null = unlimited).
 * Concurrent branch creates (and future plan changes) serialize on this lock until the caller commits, so the
 * caller must count and insert branches after this call, in the same transaction.
 *
 * Inactive or expired plans are still enforced (no lifecycle in the MVP). No subscription fails closed.
 */
export async function lockBranchLimit(ctx: TxContext): Promise<number | null> {
  const limits = await lockPlanLimits(ctx);
  if (!limits) throw new Error("lockBranchLimit: the organization has no subscription");
  return limits.maxBranches;
}
