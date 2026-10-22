import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { recordScheduleChange } from "../changes";
import { lockBranch } from "../org.repository";
import { bumpBranchVersion, deleteClosure } from "../schedule.repository";

/**
 * docs/spec/features/foundation.md#ep-branch.closure.delete · #contract-branch-closures · #rule-branch-schedule-outbox —
 * the closure must match org, branch and id; absent or already deleted → NOT_FOUND (not idempotent success).
 */
export async function branchClosureDelete(ctx: OrgRequestContext, branchId: string, closureId: string): Promise<void> {
  assertBranchInScope(ctx, branchId);
  await ctx.db.run(async (tx) => {
    if (!(await lockBranch(tx, branchId))) throw new AppError("NOT_FOUND");
    if (!(await deleteClosure(tx, branchId, closureId))) throw new AppError("NOT_FOUND");
    await recordScheduleChange(tx, ctx, branchId, await bumpBranchVersion(tx, branchId, ctx.now));
  });
}
