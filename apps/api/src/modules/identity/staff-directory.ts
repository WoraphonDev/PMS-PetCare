import { type Tx, transactionQuery } from "@app/db";

// Read-only identity data for org's staff use cases (ADR-0002: org never reads "user" itself). Both run on the caller's
// tenant transaction, so the read and org's writes see one transaction (#contract-staff-invite step 8).

/** Users whose canonical email matches (legacy mixed-case rows included); several only for legacy duplicates. */
export async function usersByEmail(tx: Tx, email: string): Promise<Array<{ id: string; isManaged: boolean }>> {
  const { rows } = await transactionQuery(tx)<{ id: string; is_managed: boolean }>`
    SELECT id, is_managed FROM "user" WHERE lower(email) = ${email.toLowerCase()} ORDER BY id`;
  return rows.map((r) => ({ id: r.id, isManaged: r.is_managed }));
}

export interface StaffProfile {
  id: string;
  name: string;
  /** null for managed accounts: their `<id>@managed.invalid` placeholder is never shown (#tbl-identity). */
  email: string | null;
  username: string | null;
  isManaged: boolean;
  twoFactorEnabled: boolean;
}

export async function staffProfiles(tx: Tx, userIds: readonly string[]): Promise<StaffProfile[]> {
  if (userIds.length === 0) return [];
  const users = await tx.query.user.findMany({ where: (u, { inArray }) => inArray(u.id, [...userIds]) });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.isManaged ? null : u.email,
    username: u.username ?? null,
    isManaged: u.isManaged,
    twoFactorEnabled: u.twoFactorEnabled,
  }));
}
