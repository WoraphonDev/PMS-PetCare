import type { BranchClosureListResponse } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { branchExists, listClosures, toClosure } from "../schedule.repository";

/**
 * docs/spec/features/foundation.md#ep-branch.closure.list · #contract-branch-closures — the parent is checked inside the
 * tenant transaction even when the list is empty (F02/F07 → NOT_FOUND); reads never write.
 */
export async function branchClosureList(ctx: OrgRequestContext, branchId: string): Promise<BranchClosureListResponse> {
  assertBranchInScope(ctx, branchId);
  const rows = await ctx.db.run(async (tx) => {
    if (!(await branchExists(tx, branchId))) throw new AppError("NOT_FOUND");
    return listClosures(tx, branchId);
  });
  return { items: rows.map(toClosure) };
}
