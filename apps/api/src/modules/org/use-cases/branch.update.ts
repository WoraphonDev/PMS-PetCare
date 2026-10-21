import type { Branch, BranchUpdateRequest } from "@app/contracts";
import { AppError } from "../../../common/app-error";
import { assertBranchInScope, type OrgRequestContext } from "../../../common/context";
import { changedFields, pick, recordBranchChange } from "../changes";
import { isUniqueViolation, lockBranch, toBranch, updateBranch } from "../org.repository";

/**
 * docs/spec/features/foundation.md#ep-branch.update · #contract-branch · #rule-branch-version · #rule-branch-outbox ·
 * #org-branch-technical-gates (1) — absent or other-org branch → NOT_FOUND (F07); a no-op PATCH writes nothing.
 */
export async function branchUpdate(ctx: OrgRequestContext, branchId: string, input: BranchUpdateRequest): Promise<Branch> {
  assertBranchInScope(ctx, branchId);
  try {
    return await ctx.db.run(async (tx) => {
      const row = await lockBranch(tx, branchId);
      if (!row) throw new AppError("NOT_FOUND");
      const current = toBranch(row);
      const fields = changedFields(current, input);
      if (fields.length === 0) return current;
      const updated = toBranch(await updateBranch(tx, branchId, { ...current, ...input }, ctx.now));
      await recordBranchChange(tx, ctx, "branch.updated", updated, { before: pick(current, fields), after: pick(updated, fields) }, fields);
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error, "branch_org_id_name_unique")) throw new AppError("CONFLICT", "Branch name already in use");
    throw error;
  }
}
