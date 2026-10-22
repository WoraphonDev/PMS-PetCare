import type { StaffAccountCreateRequest, StaffMember } from "@app/contracts";
import { writeAudit } from "@app/db";
import { isOrgWideRole } from "@app/domain";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { type Auth, createManagedAccount, hashPassword, usernameTaken } from "../../identity";
import { lockStaffLimit } from "../../subscription";
import { withoutParams } from "../db-error";
import { isUniqueViolation } from "../org.repository";
import { countSeats, existingBranchIds, isOrgSuspended, joinMembership } from "../staff.repository";

/**
 * docs/spec/features/foundation.md#contract-staff-account-create — checks in the numbered §15 order (the first failure
 * answers); phase 2 holds the subscription lock of #rule-staff-check-and-lock. The password and its hash never leave
 * this function except into the identity tables.
 */
export async function staffAccountCreate(ctx: OrgRequestContext, input: StaffAccountCreateRequest, auth: Auth): Promise<StaffMember> {
  // 3–4: request-only rules (#rule-managed-account-roles, F02).
  if (ctx.membership.role === "manager" && isOrgWideRole(input.role)) throw new AppError("FORBIDDEN");
  if (!isOrgWideRole(input.role) && input.branchIds.length === 0) throw new AppError("BRANCH_REQUIRED");
  const passwordHash = await hashPassword(auth, input.password);
  try {
    return await ctx.db.run(async (tx) => {
      // 5: subscription lock, then F04 again (it may have changed while this request waited).
      const limit = await lockStaffLimit({ tx, orgId: ctx.org.id });
      if (await isOrgSuspended(tx, ctx.org.id)) throw new AppError("ORG_SUSPENDED");
      // 6: F07 — unknown and other-org branch ids look the same.
      const branches = await existingBranchIds(tx, input.branchIds);
      if (input.branchIds.some((id) => !branches.has(id))) throw new AppError("NOT_FOUND");
      // 7: F05 — no invitation is replaced here, and an empty email matches none.
      if (limit !== null && (await countSeats(tx, ctx.now, "")) >= limit) throw new AppError("PLAN_LIMIT_REACHED");
      // 8: any account, any case; a parallel create in another org surfaces as the unique violation below.
      if (await usernameTaken(tx, input.username)) throw new AppError("CONFLICT");

      const userId = await createManagedAccount(tx, {
        orgId: ctx.org.id,
        username: input.username,
        displayName: input.displayName,
        passwordHash,
        now: ctx.now,
      });
      const join = { orgId: ctx.org.id, userId, displayName: input.displayName, role: input.role, branchIds: input.branchIds };
      const membershipId = await joinMembership(tx, join, ctx.now);
      const branchIds = [...input.branchIds].sort();
      await writeAudit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.user.id,
        action: "staff.account_created",
        entityType: "membership",
        entityId: membershipId,
        before: null,
        after: { username: input.username, displayName: input.displayName, role: input.role, branchIds },
        occurredAt: ctx.now,
      });
      return {
        membershipId,
        userId,
        displayName: input.displayName,
        email: null,
        username: input.username,
        role: input.role,
        branchIds,
        status: "active",
        isManaged: true,
        twoFactorEnabled: false,
        createdAt: ctx.now.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error, "user_username_unique")) throw new AppError("CONFLICT");
    throw withoutParams("staff.account.create", error);
  }
}
