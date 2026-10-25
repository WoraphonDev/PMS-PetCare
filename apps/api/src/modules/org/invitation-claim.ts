import { type Tx, writeAudit } from "@app/db";
import type { Role } from "@app/domain";
import { AppError } from "../../common/app-error";
import { lockStaffLimit } from "../subscription";
import { hashInvitationToken } from "./invitation-token";
import { findInvitationByHash, isOrgSuspended, joinMembership, lockInvitation, markInvitationAccepted } from "./staff.repository";

// docs/spec/features/foundation.md#contract-invitation-accept steps 6–10 and the accept write, shared by
// invitation.accept and auth.signupWithInvitation (#contract-signup-with-invitation). Both run on the caller's tenant
// transaction (`withTenant(orgId from the token)`), so the caller's writes and these commit or roll back together.

export interface ClaimedInvitation {
  id: string;
  email: string;
  role: Role;
  branchIds: string[];
}

/**
 * Steps 6–10: unlocked preflight by token hash → status → lock subscription → lock the invitation and re-check →
 * re-read status. `email` is compared (ignoring case) only when given: a new account takes the invitation's email.
 */
export async function claimInvitation(tx: Tx, orgId: string, token: string, now: Date, email?: string): Promise<ClaimedInvitation> {
  const usable = (row: (ClaimedInvitation & { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) | undefined) =>
    !!row &&
    !row.acceptedAt &&
    !row.revokedAt &&
    row.expiresAt > now &&
    (email === undefined || row.email.toLowerCase() === email.toLowerCase());
  const found = await findInvitationByHash(tx, hashInvitationToken(token)); // 6
  if (!found || !usable(found)) throw new AppError("INVITATION_INVALID");
  if (await isOrgSuspended(tx, orgId)) throw new AppError("ORG_SUSPENDED"); // 7
  await lockStaffLimit({ tx, orgId }); // 8 — serialises the seat change; no limit check
  const row = await lockInvitation(tx, found.id); // 9
  if (!row || !usable(row)) throw new AppError("INVITATION_INVALID");
  if (await isOrgSuspended(tx, orgId)) throw new AppError("ORG_SUSPENDED"); // 10
  return { id: row.id, email: row.email, role: row.role, branchIds: row.branchIds };
}

/** The accept write: membership (+ branches), `accepted_at`, audit `staff.joined` with the joining user as actor. */
export async function writeInvitationAccept(
  tx: Tx,
  join: { orgId: string; invitation: ClaimedInvitation; userId: string; displayName: string; existingId?: string },
  now: Date,
): Promise<string> {
  const { orgId, invitation: row } = join;
  const membershipId = await joinMembership(
    tx,
    { orgId, userId: join.userId, displayName: join.displayName, role: row.role, branchIds: row.branchIds, existingId: join.existingId },
    now,
  );
  await markInvitationAccepted(tx, row.id, now);
  await writeAudit(tx, {
    orgId,
    actorUserId: join.userId,
    action: "staff.joined",
    entityType: "membership",
    entityId: membershipId,
    before: join.existingId ? { status: "removed" } : null,
    after: { role: row.role, branchIds: row.branchIds, invitationId: row.id },
    occurredAt: now,
  });
  return membershipId;
}
