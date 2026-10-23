import { writeAudit } from "@app/db";
import { canManageMember } from "@app/domain";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { deleteAllSessions, managedOwnerOf } from "../../identity";
import { lockStaffLimit } from "../../subscription";
import { recheckCaller } from "../caller-recheck";
import { withoutParams } from "../db-error";
import { countActiveOwners, isOrgSuspended, lockMembership, membershipBranchIds, removeMembership } from "../staff.repository";

/**
 * docs/spec/features/foundation.md#contract-staff-remove — checks in §16 order under the subscription lock. The seat is
 * freed by the status change itself (#rule-staff-capacity). Only a managed account of this org is signed out
 * everywhere (F09: it is unusable now); a real-email account keeps its sessions, and the org guard blocks this shop.
 */
export async function staffRemove(ctx: OrgRequestContext, membershipId: string): Promise<void> {
  try {
    await ctx.db.run(async (tx) => {
      await lockStaffLimit({ tx, orgId: ctx.org.id });
      if (await isOrgSuspended(tx, ctx.org.id)) throw new AppError("ORG_SUSPENDED");
      const callerRole = await recheckCaller(tx, ctx.membership.id, "staff.remove");
      const target = await lockMembership(tx, membershipId);
      if (target?.status !== "active") throw new AppError("NOT_FOUND");
      if (!canManageMember(callerRole, target.role)) throw new AppError("FORBIDDEN");
      if (target.role === "owner" && (await countActiveOwners(tx)) <= 1) throw new AppError("LAST_OWNER");

      const branchIds = await membershipBranchIds(tx, target.id);
      await removeMembership(tx, target.id, ctx.now);
      if ((await managedOwnerOf(tx, target.userId)) === ctx.org.id) await deleteAllSessions(tx, target.userId);
      await writeAudit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.user.id,
        action: "staff.removed",
        entityType: "membership",
        entityId: target.id,
        before: { status: "active", role: target.role, branchIds },
        after: { status: "removed" },
        occurredAt: ctx.now,
      });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("staff.remove", error);
  }
}
