import { isOrgWideRole } from "@app/domain";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import { lockStaffLimit } from "../../subscription";
import { withoutParams } from "../db-error";
import { isOrgSuspended, lockInvitation, revokeInvitations } from "../staff.repository";

/**
 * docs/spec/features/foundation.md#contract-staff-invitation-revoke — locks per #rule-staff-check-and-lock; only a
 * pending invitation can be revoked (anything else → NOT_FOUND, before the ¹ manager rule). No audit (§6 has no action).
 */
export async function staffInvitationRevoke(ctx: OrgRequestContext, invitationId: string): Promise<void> {
  try {
    await ctx.db.run(async (tx) => {
      await lockStaffLimit({ tx, orgId: ctx.org.id });
      const row = await lockInvitation(tx, invitationId);
      if (await isOrgSuspended(tx, ctx.org.id)) throw new AppError("ORG_SUSPENDED");
      if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= ctx.now) throw new AppError("NOT_FOUND");
      if (ctx.membership.role === "manager" && isOrgWideRole(row.role)) throw new AppError("FORBIDDEN");
      await revokeInvitations(tx, [row.id], ctx.now);
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("staff.invitation.revoke", error);
  }
}
