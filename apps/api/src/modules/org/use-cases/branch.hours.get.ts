import type { BranchHoursGetResponse } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { branchExists, listHours } from "../schedule.repository";

// PostgreSQL time text (HH:MM:SS[.ffffff]) → canonical HH:mm (#contract-branch-hours).
const hhMm = (time: string | null) => (time === null ? null : time.slice(0, 5));

/**
 * docs/spec/features/foundation.md#contract-branch-hours-get — same branch lookup as branch.closure.list (F02/F07 →
 * NOT_FOUND) and the PUT response projection; no lock, no version bump, no audit, no outbox.
 */
export async function branchHoursGet(ctx: OrgRequestContext, branchId: string): Promise<BranchHoursGetResponse> {
  assertBranchInScope(ctx, branchId);
  const rows = await ctx.db.run(async (tx) => {
    if (!(await branchExists(tx, branchId))) throw new AppError("NOT_FOUND");
    return listHours(tx, branchId);
  });
  // #tbl-branch_hours invariant: exactly ISO weekdays 1–7. Never repaired here → INTERNAL.
  if (rows.length !== 7 || rows.some((row, i) => row.weekday !== i + 1)) {
    throw new Error("branch_hours invariant violated: expected ISO weekdays 1-7");
  }
  return { items: rows.map((row) => ({ weekday: row.weekday, opensAt: hhMm(row.opensAt), closesAt: hhMm(row.closesAt) })) };
}
