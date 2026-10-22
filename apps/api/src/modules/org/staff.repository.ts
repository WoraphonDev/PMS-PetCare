import type { Invitation } from "@app/contracts";
import { invitation, membership, membershipBranch, type Tx, transactionQuery } from "@app/db";
import type { Role } from "@app/domain";

// Staff and invitation queries; every one runs on a tenant transaction (RLS = the caller's organization).
// Seat-changing writers lock in the order of #rule-staff-check-and-lock: subscription → invitations → memberships.

type InvitationRow = typeof invitation.$inferSelect;

export function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    branchIds: row.branchIds,
    expiresAt: row.expiresAt.toISOString(),
    invitedByUserId: row.invitedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * #rule-staff-capacity in one statement (one snapshot): active memberships + unexpired pending invitations, without
 * the pending invitations of `replacingEmail` that the caller is about to revoke.
 */
export async function countSeats(tx: Tx, now: Date, replacingEmail: string): Promise<number> {
  const { rows } = await transactionQuery(tx)<{ seats: number }>`
    SELECT (SELECT count(*) FROM membership WHERE status = 'active')
         + (SELECT count(*) FROM invitation
             WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ${now} AND email <> ${replacingEmail}) AS seats`;
  return Number(rows[0]?.seats ?? 0);
}

/** Lock step 2 for invite: the pending invitations of one email, in id order. */
export async function lockPendingInvitations(tx: Tx, email: string, now: Date): Promise<Array<{ id: string; role: Role }>> {
  const { rows } = await transactionQuery(tx)<{ id: string; role: Role }>`
    SELECT id, role FROM invitation
     WHERE email = ${email} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ${now}
     ORDER BY id FOR UPDATE`;
  return rows;
}

/** Lock step 2 for revoke/accept: one invitation, whatever its state; undefined when absent or of another org. */
export async function lockInvitation(tx: Tx, id: string): Promise<InvitationRow | undefined> {
  const { rows } = await transactionQuery(tx)`SELECT id FROM invitation WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) return undefined;
  return tx.query.invitation.findFirst({ where: (i, { eq }) => eq(i.id, id) });
}

/** Lock step 3: the memberships of these users in this organization, in id order. */
export async function lockMemberships(tx: Tx, userIds: readonly string[]): Promise<Array<{ id: string; status: string }>> {
  if (userIds.length === 0) return [];
  // drizzle expands an array parameter into `($1, $2, …)`.
  const { rows } = await transactionQuery(tx)<{ id: string; status: string }>`
    SELECT id, status FROM membership WHERE user_id IN ${[...userIds]} ORDER BY id FOR UPDATE`;
  return rows;
}

/** Locks one membership of this organization (RLS hides the others); undefined when absent. */
export async function lockMembership(tx: Tx, id: string): Promise<{ id: string; userId: string; role: Role; status: string } | undefined> {
  const { rows } = await transactionQuery(tx)<{ id: string; user_id: string; role: Role; status: string }>`
    SELECT id, user_id, role, status FROM membership WHERE id = ${id} FOR UPDATE`;
  const [row] = rows;
  return row && { id: row.id, userId: row.user_id, role: row.role, status: row.status };
}

/** Branch ids of this organization among `ids` (RLS hides other organizations' branches — F07). */
export async function existingBranchIds(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.query.branch.findMany({ columns: { id: true }, where: (b, { inArray }) => inArray(b.id, [...ids]) });
  return new Set(rows.map((b) => b.id));
}

export async function revokeInvitations(tx: Tx, ids: readonly string[], now: Date): Promise<void> {
  for (const id of ids) await transactionQuery(tx)`UPDATE invitation SET revoked_at = ${now}, updated_at = ${now} WHERE id = ${id}`;
}

export async function insertInvitation(
  tx: Tx,
  row: { orgId: string; email: string; role: Role; branchIds: string[]; tokenHash: string; invitedByUserId: string },
  now: Date,
  expiresAt: Date,
): Promise<InvitationRow> {
  const [created] = await tx
    .insert(invitation)
    .values({ ...row, expiresAt, createdAt: now, updatedAt: now })
    .returning();
  if (!created) throw new Error("insertInvitation: the insert returned no row");
  return created;
}

export async function listActiveMembers(tx: Tx) {
  const [members, assigned] = await Promise.all([
    tx.query.membership.findMany({ where: (m, { eq }) => eq(m.status, "active") }),
    tx.query.membershipBranch.findMany(),
  ]);
  return members.map((m) => ({
    ...m,
    branchIds: assigned
      .filter((a) => a.membershipId === m.id)
      .map((a) => a.branchId)
      .sort(),
  }));
}

export async function listPendingInvitations(tx: Tx, now: Date): Promise<InvitationRow[]> {
  return tx.query.invitation.findMany({
    where: (i, { and, gt, isNull }) => and(isNull(i.acceptedAt), isNull(i.revokedAt), gt(i.expiresAt, now)),
  });
}

/** Phase-2 re-check of what the org guard read in phase 1 (#rule-staff-check-and-lock). */
export async function isOrgSuspended(tx: Tx, orgId: string): Promise<boolean> {
  const org = await tx.query.organization.findFirst({ columns: { status: true }, where: (o, { eq }) => eq(o.id, orgId) });
  return org?.status !== "active";
}

/** #contract-invitation-accept step 6 preflight: unlocked read by token hash. */
export async function findInvitationByHash(tx: Tx, tokenHash: string): Promise<InvitationRow | undefined> {
  return tx.query.invitation.findFirst({ where: (i, { eq }) => eq(i.tokenHash, tokenHash) });
}

export async function markInvitationAccepted(tx: Tx, id: string, now: Date): Promise<void> {
  await transactionQuery(tx)`UPDATE invitation SET accepted_at = ${now}, updated_at = ${now} WHERE id = ${id}`;
}

/** New membership (`display_name` from the account) or a removed one made active again, with the invited branches. */
export async function joinMembership(
  tx: Tx,
  join: { orgId: string; userId: string; displayName: string; role: Role; branchIds: readonly string[]; existingId?: string },
  now: Date,
): Promise<string> {
  let id = join.existingId;
  if (id) {
    await transactionQuery(tx)`UPDATE membership SET status = 'active', role = ${join.role}, updated_at = ${now} WHERE id = ${id}`;
    await transactionQuery(tx)`DELETE FROM membership_branch WHERE membership_id = ${id}`;
  } else {
    const [row] = await tx
      .insert(membership)
      .values({ orgId: join.orgId, userId: join.userId, role: join.role, displayName: join.displayName, createdAt: now, updatedAt: now })
      .returning();
    if (!row) throw new Error("joinMembership: the insert returned no row");
    id = row.id;
  }
  const membershipId = id;
  for (const branchId of join.branchIds)
    await tx.insert(membershipBranch).values({ orgId: join.orgId, membershipId, branchId, createdAt: now });
  return membershipId;
}
