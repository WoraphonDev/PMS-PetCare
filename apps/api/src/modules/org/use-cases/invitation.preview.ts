import type { InvitationPreviewRequest, InvitationPreviewResponse } from "@app/contracts";
import { type Db, withTenant } from "@app/db";
import { AppError } from "../../../common/app-error";
import { withoutParams } from "../db-error";
import { hashInvitationToken, invitationTokenOrg } from "../invitation-token";
import { branchNamesOf, findInvitationByHash, isOrgSuspended, orgDisplayName } from "../staff.repository";

/**
 * docs/spec/features/foundation.md#contract-invitation-preview — public and read-only: no lock, no write, no audit. The
 * answer never says whether the invited email already has an account.
 */
export async function invitationPreview(
  input: InvitationPreviewRequest,
  deps: { runtimeDb: Db; now: Date },
): Promise<InvitationPreviewResponse> {
  const orgId = invitationTokenOrg(input.token);
  if (!orgId) throw new AppError("INVITATION_INVALID");
  try {
    return await withTenant(deps.runtimeDb, orgId, async (tx) => {
      const row = await findInvitationByHash(tx, hashInvitationToken(input.token));
      if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= deps.now) throw new AppError("INVITATION_INVALID");
      if (await isOrgSuspended(tx, orgId)) throw new AppError("ORG_SUSPENDED");
      return {
        orgDisplayName: await orgDisplayName(tx, orgId),
        role: row.role,
        branchNames: await branchNamesOf(tx, row.branchIds),
        email: row.email,
        expiresAt: row.expiresAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw withoutParams("invitation.preview", error);
  }
}
