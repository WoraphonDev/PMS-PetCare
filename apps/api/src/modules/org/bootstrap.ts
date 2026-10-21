import { branch, membership, organization, type TxContext } from "@app/db";
import { BRANCH_TIMEZONE, insertDefaultHours } from "./org.repository";

export interface BootstrapOrganizationInput {
  /** Already validated against the signup contract (foundation#rule-signup-input). */
  slug: string;
  displayName: string;
  branchName: string;
  ownerUserId: string;
  ownerDisplayName: string;
}

export interface BootstrapOrganizationResult {
  orgId: string;
  branchId: string;
  membershipId: string;
}

/**
 * Creates the organization, its first branch with 7 branch_hours rows and the owner membership on the caller's
 * transaction (foundation#rule-signup-atomic). The organization id is the one `withTenantTx` put in the RLS
 * context, so every row belongs to that organization; the caller commits or rolls back.
 *
 * No `membership_branch` row: an owner is organization-wide (F02).
 */
export async function bootstrapOrganization(ctx: TxContext, input: BootstrapOrganizationInput): Promise<BootstrapOrganizationResult> {
  const { tx, orgId } = ctx;

  const [org] = await tx
    .insert(organization)
    .values({ id: orgId, slug: input.slug, displayName: input.displayName, status: "active" })
    .returning({ id: organization.id });
  if (!org) throw new Error("bootstrapOrganization: the organization insert returned no row");

  const [firstBranch] = await tx
    .insert(branch)
    .values({ orgId, name: input.branchName, timezone: BRANCH_TIMEZONE, isActive: true })
    .returning({ id: branch.id });
  if (!firstBranch) throw new Error("bootstrapOrganization: the branch insert returned no row");

  await insertDefaultHours(tx, orgId, firstBranch.id);

  const [owner] = await tx
    .insert(membership)
    .values({ orgId, userId: input.ownerUserId, role: "owner", displayName: input.ownerDisplayName, status: "active" })
    .returning({ id: membership.id });
  if (!owner) throw new Error("bootstrapOrganization: the owner membership insert returned no row");

  return { orgId, branchId: firstBranch.id, membershipId: owner.id };
}
