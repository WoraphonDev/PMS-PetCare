import type { Invitation } from "@app/contracts";
import { invitation, type Tx, transactionQuery } from "@app/db";
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
