import { randomUUID } from "node:crypto";
import { account, type Tx, transactionQuery, user } from "@app/db";
import type { Auth } from "./auth";

// docs/spec/features/foundation.md#rule-managed-account-identity · #contract-staff-password-reset — identity owns every
// write to its tables (ADR-0002). Each function runs on org's tenant transaction, so the account, the membership and
// the audit row commit or roll back together. The identity tables have no RLS; the runtime role may write them.

/** Better Auth's own hasher, so username login verifies the hash unchanged. Slow on purpose: call it before locking. */
export async function hashPassword(auth: Auth, password: string): Promise<string> {
  return (await auth.$context).password.hash(password);
}

/** `user.username` is citext: any account, managed or real-email, in any case. */
export async function usernameTaken(tx: Tx, username: string): Promise<boolean> {
  const { rows } = await transactionQuery(tx)`SELECT 1 FROM "user" WHERE username = ${username}`;
  return rows.length > 0;
}

/** The org that owns a managed account; null for a real-email account or an unknown id. */
export async function managedOwnerOf(tx: Tx, userId: string): Promise<string | null> {
  const found = await tx.query.user.findFirst({
    columns: { isManaged: true, managedByOrgId: true },
    where: (u, { eq }) => eq(u.id, userId),
  });
  return found?.isManaged ? found.managedByOrgId : null;
}

/** T-0016-02: the user (placeholder email, never verified) and its credential account; no session, no email. */
export async function createManagedAccount(
  tx: Tx,
  input: { orgId: string; username: string; displayName: string; passwordHash: string; now: Date },
): Promise<string> {
  const id = randomUUID();
  await tx.insert(user).values({
    id,
    name: input.displayName,
    email: `${id}@managed.invalid`,
    emailVerified: false,
    username: input.username,
    displayUsername: input.username,
    isManaged: true,
    managedByOrgId: input.orgId,
    mustChangePassword: true,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await tx.insert(account).values({
    accountId: id,
    providerId: "credential",
    userId: id,
    password: input.passwordHash,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return id;
}

/** T-0016-03: new hash, must change it at next login, signed out everywhere (sessions and their 2FA markers); 2FA kept. */
export async function setManagedPassword(tx: Tx, input: { userId: string; passwordHash: string; now: Date }): Promise<void> {
  const q = transactionQuery(tx);
  await q`UPDATE account SET password = ${input.passwordHash}, updated_at = ${input.now}
           WHERE user_id = ${input.userId} AND provider_id = 'credential'`;
  await q`UPDATE "user" SET must_change_password = true, updated_at = ${input.now} WHERE id = ${input.userId}`;
  await q`DELETE FROM verification WHERE value = ${input.userId} AND identifier LIKE '2fa-session:%'`;
  await q`DELETE FROM session WHERE user_id = ${input.userId}`;
}
