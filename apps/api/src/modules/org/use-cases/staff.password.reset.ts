import type { StaffPasswordResetRequest } from "@app/contracts";
import { writeAudit } from "@app/db";
import { isOrgWideRole } from "@app/domain";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { type Auth, hashPassword, managedOwnerOf, setManagedPassword } from "../../identity";
import { withoutParams } from "../db-error";
import { isOrgSuspended, lockMembership } from "../staff.repository";

/**
 * docs/spec/features/foundation.md#contract-staff-password-reset — checks in the numbered §15 order. No subscription
 * lock: a reset changes no seat. The manager rule comes before MANAGED_ACCOUNT_ONLY so a manager cannot learn whether
 * an owner's or manager's account is managed.
 */
export async function staffPasswordReset(
  ctx: OrgRequestContext,
  membershipId: string,
  input: StaffPasswordResetRequest,
  auth: Auth,
): Promise<void> {
  const passwordHash = await hashPassword(auth, input.newPassword);
  try {
    await ctx.db.run(async (tx) => {
      // 3: F07 — absent, other-org and removed memberships look the same.
      const target = await lockMembership(tx, membershipId);
      if (target?.status !== "active") throw new AppError("NOT_FOUND");
      // 4–6
      if (await isOrgSuspended(tx, ctx.org.id)) throw new AppError("ORG_SUSPENDED");
      if (ctx.membership.role === "manager" && isOrgWideRole(target.role)) throw new AppError("FORBIDDEN");
      if ((await managedOwnerOf(tx, target.userId)) !== ctx.org.id) throw new AppError("MANAGED_ACCOUNT_ONLY");

      await setManagedPassword(tx, { userId: target.userId, passwordHash, now: ctx.now });
      await writeAudit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.user.id,
        action: "staff.password_reset",
        entityType: "membership",
        entityId: target.id,
        before: null,
        after: null,
        occurredAt: ctx.now,
      });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("staff.password.reset", error);
  }
}
