import type { StaffMember, StaffUpdateRequest } from "@app/contracts";
import { type Tx, writeAudit } from "@app/db";
import { canManageMember, isOrgWideRole, type Role } from "@app/domain";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { staffProfiles } from "../../identity";
import { lockStaffLimit } from "../../subscription";
import { recheckCaller } from "../caller-recheck";
import { withoutParams } from "../db-error";
import {
  countActiveOwners,
  existingBranchIds,
  isOrgSuspended,
  lockMembership,
  membershipBranchIds,
  updateMembership,
} from "../staff.repository";

type Fields = { role?: Role; branchIds?: string[]; displayName?: string };

/**
 * docs/spec/features/foundation.md#contract-staff-update — checks in the numbered §16 order (the first failure answers),
 * all in phase 2 under the subscription lock. Every effective change writes `staff.role_changed` with the changed fields
 * only (T-0017-03); a no-op writes nothing.
 */
export async function staffUpdate(ctx: OrgRequestContext, membershipId: string, input: StaffUpdateRequest): Promise<StaffMember> {
  try {
    return await ctx.db.run(async (tx) => {
      // 3: locks, F04 again, the caller again, then the target (F07: absent, other org and removed look the same).
      await lockStaffLimit({ tx, orgId: ctx.org.id });
      if (await isOrgSuspended(tx, ctx.org.id)) throw new AppError("ORG_SUSPENDED");
      const callerRole = await recheckCaller(tx, ctx.membership.id, "staff.update");
      const target = await lockMembership(tx, membershipId);
      if (target?.status !== "active") throw new AppError("NOT_FOUND");
      const role = input.role ?? target.role;
      // 4: ¹ with the caller's current role, on both the existing and the new role (incl. the caller's own membership).
      if (!canManageMember(callerRole, target.role) || !canManageMember(callerRole, role)) throw new AppError("FORBIDDEN");
      // 5: the resulting role/branch state (F02, T-0017-04).
      const current = await membershipBranchIds(tx, target.id);
      const branchIds = await resultingBranches(tx, role, target.role, current, input.branchIds);
      // 6: F01.
      if (target.role === "owner" && role !== "owner" && (await countActiveOwners(tx)) <= 1) throw new AppError("LAST_OWNER");

      const displayName = input.displayName ?? target.displayName;
      const before: Fields = {};
      const after: Fields = {};
      if (role !== target.role) [before.role, after.role] = [target.role, role];
      if (branchIds.join() !== current.join()) [before.branchIds, after.branchIds] = [current, branchIds];
      if (displayName !== target.displayName) [before.displayName, after.displayName] = [target.displayName, displayName];
      if (Object.keys(after).length > 0) {
        const change = { orgId: ctx.org.id, id: target.id, role, displayName };
        await updateMembership(tx, after.branchIds ? { ...change, branchIds } : change, ctx.now);
        await writeAudit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.user.id,
          action: "staff.role_changed",
          entityType: "membership",
          entityId: target.id,
          before,
          after,
          occurredAt: ctx.now,
        });
      }
      const [profile] = await staffProfiles(tx, [target.userId]);
      if (!profile) throw new Error("staff.update: the member's account is missing");
      return {
        membershipId: target.id,
        userId: target.userId,
        displayName,
        email: profile.email,
        username: profile.username,
        role,
        branchIds,
        status: "active",
        isManaged: profile.isManaged,
        twoFactorEnabled: profile.twoFactorEnabled,
        createdAt: target.createdAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("staff.update", error);
  }
}

/**
 * #contract-staff-update: owner/manager have no branches (moving to one without `branchIds` clears them; sending some is
 * VALIDATION_FAILED — T-0017-04); a branch role needs ≥ 1 branch of this tenant, and keeps its branches unless new ones
 * are sent (coming from owner/manager it must send them).
 */
async function resultingBranches(tx: Tx, role: Role, from: Role, current: string[], sent: string[] | undefined): Promise<string[]> {
  if (isOrgWideRole(role)) {
    if (sent && sent.length > 0) {
      throw new AppError("VALIDATION_FAILED", "Invalid request", { fields: { branchIds: ["Owner and manager take no branches"] } });
    }
    return [];
  }
  const branchIds = [...(sent ?? (isOrgWideRole(from) ? [] : current))].sort();
  if (branchIds.length === 0) throw new AppError("BRANCH_REQUIRED");
  const found = await existingBranchIds(tx, branchIds);
  if (branchIds.some((id) => !found.has(id))) throw new AppError("NOT_FOUND");
  return branchIds;
}
