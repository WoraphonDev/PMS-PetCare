import type { BranchListResponse } from "@app/contracts";
import type { OrgRequestContext } from "../../../common/context";
import { listBranches, toBranch } from "../org.repository";

/** docs/spec/features/foundation.md#ep-branch.list · #rule-branch-list — branch roles see only assigned branches (F02). */
export async function branchList(ctx: OrgRequestContext): Promise<BranchListResponse> {
  const rows = await ctx.db.run((tx) => listBranches(tx, ctx.branchScope));
  return { items: rows.map(toBranch) };
}
