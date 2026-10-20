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
