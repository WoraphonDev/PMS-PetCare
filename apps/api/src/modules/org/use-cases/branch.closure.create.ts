import type { BranchClosureCreateRequest, Closure } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { recordScheduleChange } from "../changes";
import { lockBranch } from "../org.repository";
import { bumpBranchVersion, insertClosure, toClosure } from "../schedule.repository";

/**
 * docs/spec/features/foundation.md#ep-branch.closure.create · #contract-branch-closures · #rule-branch-closure-calendar ·
 * #rule-branch-schedule-outbox — overlapping, identical and past ranges are independent records (no CONFLICT).
 */
export async function branchClosureCreate(ctx: OrgRequestContext, branchId: string, input: BranchClosureCreateRequest): Promise<Closure> {
  assertBranchInScope(ctx, branchId);
  return ctx.db.run(async (tx) => {
    if (!(await lockBranch(tx, branchId))) throw new AppError("NOT_FOUND");
    const closure = toClosure(await insertClosure(tx, ctx.org.id, branchId, input, ctx.now));
    await recordScheduleChange(tx, ctx, branchId, await bumpBranchVersion(tx, branchId, ctx.now));
    return closure;
  });
}
