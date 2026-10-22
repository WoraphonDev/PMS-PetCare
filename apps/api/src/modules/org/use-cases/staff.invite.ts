import type { Invitation, StaffInviteRequest } from "@app/contracts";
import { writeAudit } from "@app/db";
import { isOrgWideRole } from "@app/domain";
import { AppError } from "../../../common/app-error";
import type { OrgRequestContext } from "../../../common/context";
import type { BackgroundWork } from "../../identity";
import { usersByEmail } from "../../identity";
import type { EmailSender } from "../../notification/email";
import { lockStaffLimit } from "../../subscription";
import { withoutParams } from "../db-error";
import { invitationEmail } from "../invitation-email";
import { newInvitationToken } from "../invitation-token";
import {
  countSeats,
  existingBranchIds,
  insertInvitation,
  lockMemberships,
  lockPendingInvitations,
  revokeInvitations,
  toInvitation,
} from "../staff.repository";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export interface InvitationMail {
  sender: EmailSender;
  background: BackgroundWork;
  appOrigin: string;
}

/**
 * docs/spec/features/foundation.md#contract-staff-invite — checks in the numbered §14 order (the first failure
 * answers); phase 2 holds #rule-staff-check-and-lock locks, and the email leaves only after commit.
 */
export async function staffInvite(ctx: OrgRequestContext, input: StaffInviteRequest, mail: InvitationMail): Promise<Invitation> {
  const managerCaller = ctx.membership.role === "manager";
  // 3–4: request-only rules (¹, F02).
  if (managerCaller && isOrgWideRole(input.role)) throw new AppError("FORBIDDEN");
  if (!isOrgWideRole(input.role) && input.branchIds.length === 0) throw new AppError("BRANCH_REQUIRED");
  const { token, hash } = newInvitationToken(ctx.org.id);
  let created: Invitation;
  try {
    created = await ctx.db.run(async (tx) => {
      // 5: subscription, then this email's pending invitations.
      const limit = await lockStaffLimit({ tx, orgId: ctx.org.id });
      const pending = await lockPendingInvitations(tx, input.email, ctx.now);
      // 6: F07 — unknown and other-org branch ids look the same.
      const branches = await existingBranchIds(tx, input.branchIds);
      if (input.branchIds.some((id) => !branches.has(id))) throw new AppError("NOT_FOUND");
      // 7: ¹ — a re-invite must not revoke an owner/manager invitation on a manager's behalf.
      if (managerCaller && pending.some((p) => isOrgWideRole(p.role))) throw new AppError("FORBIDDEN");
      // 8: membership of any account with this email (users are not locked; accept decides for good).
      const users = await usersByEmail(tx, input.email);
      const memberships = await lockMemberships(
        tx,
        users.map((u) => u.id),
      );
      if (memberships.some((m) => m.status === "active")) throw new AppError("ALREADY_MEMBER");
      // 9: F05.
      if (limit !== null && (await countSeats(tx, ctx.now, input.email)) >= limit) throw new AppError("PLAN_LIMIT_REACHED");

      await revokeInvitations(
        tx,
        pending.map((p) => p.id),
        ctx.now,
      );
      const expiresAt = new Date(ctx.now.getTime() + SEVEN_DAYS_MS);
      const row = toInvitation(
        await insertInvitation(
          tx,
          {
            orgId: ctx.org.id,
            email: input.email,
            role: input.role,
            branchIds: input.branchIds,
            tokenHash: hash,
            invitedByUserId: ctx.user.id,
          },
          ctx.now,
          expiresAt,
        ),
      );
      await writeAudit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.user.id,
        action: "staff.invited",
        entityType: "invitation",
        entityId: row.id,
        before: null,
        after: { email: row.email, role: row.role, branchIds: row.branchIds, expiresAt: row.expiresAt },
        occurredAt: ctx.now,
      });
      return row;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("staff.invite", error);
  }
  const message = invitationEmail(mail.appOrigin, created.email, ctx.org.displayName, created.role, token);
  mail.background.run("invitation email", () => mail.sender.send(message));
  return created;
}
