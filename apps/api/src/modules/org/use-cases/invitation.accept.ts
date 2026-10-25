import type { InvitationAcceptRequest, InvitationAcceptResponse } from "@app/contracts";
import { type Db, withTenant } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { UserRow } from "../../identity";
import { withoutParams } from "../db-error";
import { claimInvitation, writeInvitationAccept } from "../invitation-claim";
import { invitationTokenOrg } from "../invitation-token";
import { lockMemberships } from "../staff.repository";

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
  try {
    return await withTenant(deps.runtimeDb, orgId, async (tx) => {
      const row = await claimInvitation(tx, orgId, input.token, now, user.email); // 6–10
      const [existing] = await lockMemberships(tx, [user.id]); // 11
      if (existing?.status === "active") throw new AppError("ALREADY_MEMBER");
      const membershipId = await writeInvitationAccept(
        tx,
        { orgId, invitation: row, userId: user.id, displayName: user.name, existingId: existing?.id },
        now,
      );
      return { orgId, membershipId, role: row.role, branchIds: row.branchIds };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("invitation.accept", error);
  }
}
