import type { Organization } from "@app/contracts";
import { type Db, type Tx, transactionQuery, withTenant, writeAudit } from "@app/db";
import { findOrg, lockOrg, toOrganization } from "./org.repository";

// Org data for the platform module (foundation#rule-platform-module). Reads take the platform connection (BYPASSRLS),
// so every query filters by org explicitly; writes run in the target shop's tenant transaction (RLS = that shop).

export type OrgStatus = Organization["status"];
export interface OrgPosition {
  /** Postgres' own text of `created_at`, so microseconds survive a round trip through the cursor. */
  createdAt: string;
  id: string;
}
export interface OrgSearchRow {
  id: string;
  slug: string;
  displayName: string;
  status: OrgStatus;
  createdAt: Date;
  position: OrgPosition;
}
export interface OrgUsage {
  branches: number;
  staff: { active: number; pendingInvitations: number; total: number };
}

const uuidList = (ids: readonly string[]) => ids.join(",");

/**
 * #contract-platform-org-read: `q` is a case-insensitive substring of slug or display name, or the shop has an active
 * owner among `ownerUserIds` (identity resolves the email match). Newest first, then id desc; strictly after `after`.
 */
export async function searchOrgs(
  tx: Tx,
  filter: { q: string | null; ownerUserIds: readonly string[]; status: OrgStatus | null; after: OrgPosition | null },
  limit: number,
): Promise<OrgSearchRow[]> {
  const { q, status, after } = filter;
  const { rows } = await transactionQuery(tx)<{
    id: string;
    slug: string;
    display_name: string;
    status: OrgStatus;
    created_at: Date;
    created_at_text: string;
  }>`
    SELECT o.id, o.slug, o.display_name, o.status, o.created_at, o.created_at::text AS created_at_text
      FROM organization o
     WHERE (${status}::org_status IS NULL OR o.status = ${status}::org_status)
       AND (${q}::text IS NULL
            OR position(lower(${q}::text) IN lower(o.slug)) > 0
            OR position(lower(${q}::text) IN lower(o.display_name)) > 0
            OR EXISTS (SELECT 1 FROM membership m
                        WHERE m.org_id = o.id AND m.role = 'owner' AND m.status = 'active'
                          AND m.user_id = ANY (string_to_array(${uuidList(filter.ownerUserIds)}, ',')::uuid[])))
       AND (${after?.createdAt ?? null}::timestamptz IS NULL
            OR (o.created_at, o.id) < (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    status: r.status,
    createdAt: new Date(r.created_at),
    position: { createdAt: r.created_at_text, id: r.id },
  }));
}

/** Usage per shop, counted like #rule-branch-capacity and #rule-staff-capacity. */
export async function usageOf(tx: Tx, orgIds: readonly string[], now: Date): Promise<Map<string, OrgUsage>> {
  const { rows } = await transactionQuery(tx)<{ id: string; branches: number; active: number; pending: number }>`
    SELECT o.id,
           (SELECT count(*) FROM branch b WHERE b.org_id = o.id)::int AS branches,
           (SELECT count(*) FROM membership m WHERE m.org_id = o.id AND m.status = 'active')::int AS active,
           (SELECT count(*) FROM invitation i
             WHERE i.org_id = o.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ${now})::int AS pending
      FROM organization o
     WHERE o.id = ANY (string_to_array(${uuidList(orgIds)}, ',')::uuid[])`;
  return new Map(
    rows.map((r) => [
      r.id,
      { branches: r.branches, staff: { active: r.active, pendingInvitations: r.pending, total: r.active + r.pending } },
    ]),
  );
}

/** One shop and its active owner memberships (oldest first); undefined when the shop does not exist. */
export async function orgWithOwners(
  tx: Tx,
  orgId: string,
): Promise<{ organization: Organization; owners: Array<{ userId: string; displayName: string }> } | undefined> {
  const row = await findOrg(tx, orgId);
  if (!row) return undefined;
  const owners = await tx.query.membership.findMany({
    columns: { userId: true, displayName: true },
    where: (m, { and, eq }) => and(eq(m.orgId, orgId), eq(m.role, "owner"), eq(m.status, "active")),
    orderBy: (m, { asc }) => [asc(m.createdAt), asc(m.id)],
  });
  return { organization: toOrganization(row), owners };
}

/**
 * #contract-platform-org-status in the shop's tenant transaction, organization row locked: an unchanged status writes
 * nothing; otherwise `status`, `updated_at` and the `platform.org_status_changed` audit row. The reason lives only there.
 */
export function setOrgStatus(
  runtimeDb: Db,
  input: { orgId: string; status: OrgStatus; reason: string; actorUserId: string; now: Date },
): Promise<"not_found" | "unchanged" | "changed"> {
  return withTenant(runtimeDb, input.orgId, async (tx) => {
    const row = await lockOrg(tx, input.orgId);
    if (!row) return "not_found";
    if (row.status === input.status) return "unchanged";
    await transactionQuery(tx)`
      UPDATE organization SET status = ${input.status}::org_status, updated_at = ${input.now} WHERE id = ${input.orgId}`;
    await writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "platform.org_status_changed",
      entityType: "organization",
      entityId: input.orgId,
      before: { status: row.status },
      after: { status: input.status, reason: input.reason },
      occurredAt: input.now,
    });
    return "changed";
  });
}

/** `platform.org_viewed` (T-0019-03 B, T-0019-04 A): the target shop's row, written in its tenant transaction. */
export async function recordOrgViewed(runtimeDb: Db, input: { orgId: string; actorUserId: string; now: Date }): Promise<void> {
  await withTenant(runtimeDb, input.orgId, (tx) =>
    writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "platform.org_viewed",
      entityType: "organization",
      entityId: input.orgId,
      occurredAt: input.now,
    }),
  );
}
