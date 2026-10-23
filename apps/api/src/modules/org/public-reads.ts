import type { Tx } from "@app/db";
import { countBranches } from "./org.repository";
import { memberDisplayNames, seatBreakdown } from "./staff.repository";

// Read-only org data for other modules (ADR-0002). Each runs on the caller's tenant transaction (RLS = that org).

/** #rule-branch-capacity: every branch, active or not. */
export function branchCount(tx: Tx): Promise<number> {
  return countBranches(tx);
}

/** #rule-staff-capacity, split: `total` is the count the limit uses. */
export async function staffSeats(tx: Tx, now: Date): Promise<{ active: number; pendingInvitations: number; total: number }> {
  const seats = await seatBreakdown(tx, now);
  return { ...seats, total: seats.active + seats.pendingInvitations };
}

/** Membership display names in this org (removed members included); users without a membership are absent. */
export function memberNames(tx: Tx, userIds: readonly string[]): Promise<Map<string, string>> {
  return memberDisplayNames(tx, userIds);
}
