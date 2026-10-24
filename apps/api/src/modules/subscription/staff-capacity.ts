import type { TxContext } from "@app/db";
import { lockPlanLimits } from "./plan-lock";

/**
 * docs/spec/features/foundation.md#rule-staff-capacity · #rule-staff-check-and-lock step 1 — locks the organization's
 * subscription row (`FOR UPDATE`, the same row as {@link lockBranchLimit}) on the caller's tenant transaction and
 * returns its plan's `max_staff` (null = unlimited). Every seat-changing writer takes this lock first.
 *
 * Inactive or expired plans are still enforced (no lifecycle in the MVP). No subscription fails closed.
 */
export async function lockStaffLimit(ctx: TxContext): Promise<number | null> {
  const limits = await lockPlanLimits(ctx);
  if (!limits) throw new Error("lockStaffLimit: the organization has no subscription");
  return limits.maxStaff;
}
