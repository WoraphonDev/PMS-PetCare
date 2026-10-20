import { type Db, type user, withPlatform } from "@app/db";

// Queries use drizzle's relational API (`db.query.*`): its operators come from the same drizzle instance as the
// @app/db schema, so apps/api needs no drizzle-orm dependency of its own.

export type UserRow = typeof user.$inferSelect;

export async function findUserByIdentifier(db: Db, identifier: string): Promise<UserRow | undefined> {
  const value = identifier.toLowerCase();
  return db.query.user.findFirst({ where: (u, { eq }) => (value.includes("@") ? eq(u.email, value) : eq(u.username, value)) });
}

export async function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  return db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) });
}

/** The part of node-postgres' PoolClient used here (apps/api has no direct pg dependency). */
interface PoolClient {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
  release(): void;
}
/** Thrown inside `inTransaction` to roll back without an error reaching the caller. */
const ROLLBACK = Symbol("rollback");

/**
 * Raw SQL on one pooled client in one transaction. Password changes touch Better Auth's tables and ours together,
 * and Better Auth's own endpoints commit separately — these helpers keep each change all-or-nothing.
 */
async function inTransaction<T>(platformDb: Db, fn: (client: PoolClient) => Promise<T | typeof ROLLBACK>): Promise<T | null> {
  const client = (await platformDb.$client.connect()) as unknown as PoolClient;
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query(result === ROLLBACK ? "rollback" : "commit");
    return result === ROLLBACK ? null : result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const setPassword = (client: PoolClient, userId: string, passwordHash: string, now: Date) =>
  client.query(`update account set password = $1, updated_at = $2 where user_id = $3 and provider_id = 'credential'`, [
    passwordHash,
    now,
    userId,
  ]);

/** The stored hash of the user's email/username + password account (null for none). */
export async function credentialHashOf(platformDb: Db, userId: string): Promise<string | null> {
  const a = await platformDb.query.account.findFirst({
    where: (a, { and, eq }) => and(eq(a.userId, userId), eq(a.providerId, "credential")),
  });
  return a?.password ?? null;
}

/**
 * F11 + foundation §6: consume the single-use token (only if not expired at `now`), set the new password hash, revoke
 * every session and write the `auth.password_reset` audit row — together. Returns the user id, or null when the token
 * is wrong / expired / used (nothing changed).
 */
export function resetPasswordWithToken(
  platformDb: Db,
  input: { token: string; passwordHash: string; now: Date; ip: string | null; userAgent: string | null },
): Promise<string | null> {
  return inTransaction(platformDb, async (client) => {
    const consumed = await client.query<{ value: string }>(
      "delete from verification where identifier = $1 and expires_at > $2 returning value",
      [`reset-password:${input.token}`, input.now],
    );
    const userId = consumed.rows[0]?.value;
    if (!userId || (await setPassword(client, userId, input.passwordHash, input.now)).rowCount !== 1) return ROLLBACK;
    await client.query("delete from session where user_id = $1", [userId]);
    await client.query(
      `insert into audit_log (org_id, actor_user_id, action, entity_type, entity_id, ip, user_agent, occurred_at)
       values (null, $1, 'auth.password_reset', 'user', $1, $2, $3, $4)`,
      [userId, input.ip, input.userAgent, input.now],
    );
    return userId;
  });
}

/** #ep-auth.password_change: new hash, every other session revoked (current kept), must_change_password cleared — together. */
export async function changePasswordKeepingSession(
  platformDb: Db,
  input: { userId: string; sessionId: string; passwordHash: string; now: Date },
): Promise<boolean> {
  const done = await inTransaction(platformDb, async (client) => {
    if ((await setPassword(client, input.userId, input.passwordHash, input.now)).rowCount !== 1) return ROLLBACK;
    await client.query("delete from session where user_id = $1 and id <> $2", [input.userId, input.sessionId]);
    await client.query(`update "user" set must_change_password = false, updated_at = $2 where id = $1`, [input.userId, input.now]);
    return true;
  });
  return done === true;
}

/** F09: a managed account is usable only while its membership in the owning org is active. */
export async function isManagedAccountActive(platformDb: Db, u: UserRow): Promise<boolean> {
  const orgId = u.managedByOrgId;
  if (!u.isManaged || !orgId) return true;
  const m = await withPlatform(platformDb, (tx) =>
    tx.query.membership.findFirst({ where: (m, { and, eq }) => and(eq(m.userId, u.id), eq(m.orgId, orgId)) }),
  );
  return m?.status === "active";
}

/**
 * Active memberships of one user across organizations (cross-org read → platform connection, always filtered by user id).
 * Org-wide roles see every active branch; branch roles see their assigned branches (F02).
 */
export async function membershipsOf(platformDb: Db, userId: string) {
  return withPlatform(platformDb, async (tx) => {
    const memberships = await tx.query.membership.findMany({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.status, "active")),
    });
    if (memberships.length === 0) return [];
    const orgIds = memberships.map((m) => m.orgId);
    const [orgs, branches, assigned] = await Promise.all([
      tx.query.organization.findMany({ where: (o, { inArray }) => inArray(o.id, orgIds) }),
      tx.query.branch.findMany({ where: (b, { and, eq, inArray }) => and(inArray(b.orgId, orgIds), eq(b.isActive, true)) }),
      tx.query.membershipBranch.findMany({
        where: (mb, { inArray }) =>
          inArray(
            mb.membershipId,
            memberships.map((m) => m.id),
          ),
      }),
    ]);
    return memberships.flatMap((m) => {
      const org = orgs.find((o) => o.id === m.orgId);
      if (!org) return [];
      const orgWide = m.role === "owner" || m.role === "manager";
      const mine = new Set(assigned.filter((a) => a.membershipId === m.id).map((a) => a.branchId));
      return [
        {
          org: { id: org.id, slug: org.slug, displayName: org.displayName, status: org.status },
          role: m.role,
          branches: branches.filter((b) => b.orgId === org.id && (orgWide || mine.has(b.id))).map(({ id, name }) => ({ id, name })),
        },
      ];
    });
  });
}
