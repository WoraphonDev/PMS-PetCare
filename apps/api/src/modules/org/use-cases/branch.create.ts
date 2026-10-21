import type { Branch, BranchCreateRequest } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { lockBranchLimit } from "../../subscription";
import { recordBranchChange } from "../changes";
import { countBranches, insertBranch, insertDefaultHours, isUniqueViolation, toBranch } from "../org.repository";

/**
 * docs/spec/features/foundation.md#ep-branch.create · #contract-branch · #rule-branch-capacity · #rule-branch-outbox
 * The subscription lock is taken before counting and inserting, so concurrent creates cannot exceed max_branches (F05).
 */
export async function branchCreate(ctx: OrgRequestContext, input: BranchCreateRequest): Promise<Branch> {
  try {
    return await ctx.db.run(async (tx) => {
      const limit = await lockBranchLimit({ tx, orgId: ctx.org.id });
      if (limit !== null && (await countBranches(tx)) >= limit) throw new AppError("PLAN_LIMIT_REACHED");
      const created = toBranch(await insertBranch(tx, ctx.org.id, input, ctx.now));
      await insertDefaultHours(tx, ctx.org.id, created.id);
      const { promptpayId: _excluded, ...after } = created;
      await recordBranchChange(tx, ctx, "branch.created", created, { before: null, after });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, "branch_org_id_name_unique")) throw new AppError("CONFLICT", "Branch name already in use");
    throw error;
  }
}
