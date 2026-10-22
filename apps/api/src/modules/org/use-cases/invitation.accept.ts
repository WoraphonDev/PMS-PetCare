import type { InvitationAcceptRequest, InvitationAcceptResponse } from "@app/contracts";
import { type Db, withTenant, writeAudit } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { UserRow } from "../../identity";
import { lockStaffLimit } from "../../subscription";
import { withoutParams } from "../db-error";
import { hashInvitationToken, invitationTokenOrg } from "../invitation-token";
import {
  findInvitationByHash,
  isOrgSuspended,
  joinMembership,
  lockInvitation,
  lockMemberships,
  markInvitationAccepted,
} from "../staff.repository";

type Row = NonNullable<Awaited<ReturnType<typeof lockInvitation>>>;

/**
 * docs/spec/features/foundation.md#contract-invitation-accept — the §14 check order: phase 1 (no lock, no write) ends with
 * an unlocked preflight read; phase 2 locks subscription → invitation → membership and re-checks before writing.
 * No max_staff comparison: the seat was reserved by the invitation (#rule-staff-capacity).
 */
export async function invitationAccept(
  user: UserRow,
  input: InvitationAcceptRequest,
  deps: { runtimeDb: Db; now: Date },
): Promise<InvitationAcceptResponse> {
  const { now } = deps;
  const orgId = invitationTokenOrg(input.token); // 3
  if (!orgId || user.isManaged) throw new AppError("INVITATION_INVALID"); // 3–4 (F09)
  if (!user.emailVerified) throw new AppError("UNAUTHENTICATED", "Sign in required"); // 5 (#rule-email-login-policy)
  const usable = (row: Row | undefined): row is Row =>
    !!row && !row.acceptedAt && !row.revokedAt && row.expiresAt > now && row.email.toLowerCase() === user.email.toLowerCase();
  try {
    return await withTenant(deps.runtimeDb, orgId, async (tx) => {
      const found = await findInvitationByHash(tx, hashInvitationToken(input.token)); // 6
      if (!usable(found)) throw new AppError("INVITATION_INVALID");
      if (await isOrgSuspended(tx, orgId)) throw new AppError("ORG_SUSPENDED"); // 7
      await lockStaffLimit({ tx, orgId }); // 8 — serialises the seat change; no limit check
      const row = await lockInvitation(tx, found.id); // 9
      if (!usable(row)) throw new AppError("INVITATION_INVALID");
      if (await isOrgSuspended(tx, orgId)) throw new AppError("ORG_SUSPENDED"); // 10
      const [existing] = await lockMemberships(tx, [user.id]); // 11
      if (existing?.status === "active") throw new AppError("ALREADY_MEMBER");
      const membershipId = await joinMembership(
        tx,
        { orgId, userId: user.id, displayName: user.name, role: row.role, branchIds: row.branchIds, existingId: existing?.id },
        now,
      );
      await markInvitationAccepted(tx, row.id, now);
      await writeAudit(tx, {
        orgId,
        actorUserId: user.id,
        action: "staff.joined",
        entityType: "membership",
        entityId: membershipId,
        before: existing ? { status: "removed" } : null,
        after: { role: row.role, branchIds: row.branchIds, invitationId: row.id },
        occurredAt: now,
      });
      return { orgId, membershipId, role: row.role, branchIds: row.branchIds };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("invitation.accept", error);
  }
}
