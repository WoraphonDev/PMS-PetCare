import type { Branch, Organization } from "@app/contracts";
import { branch, branchHours, type organization, type Tx, transactionQuery } from "@app/db";

// Every query runs on a tenant transaction (ctx.db.run): RLS limits it to the caller's organization.
// Raw SQL goes through transactionQuery — apps/api has no drizzle-orm dependency of its own.

// docs/spec/features/foundation.md#tbl-branch_hours — 7 rows per branch, ISO weekdays, default 09:00–18:00.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
// F06: MVP branches are all Asia/Bangkok.
export const BRANCH_TIMEZONE = "Asia/Bangkok";

type OrgRow = typeof organization.$inferSelect;
type BranchRow = typeof branch.$inferSelect;
export type OrgFields = Pick<Organization, "displayName" | "legalName" | "taxId" | "phone" | "receiptFooter">;
export type BranchFields = Pick<Branch, "name" | "address" | "phone" | "latitude" | "longitude" | "isActive">;

export function toOrganization(row: OrgRow): Organization {
  const { createdAt, updatedAt, ...rest } = row;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

/** Response DTO (#contract-branch): no orgId, numeric(9,6) as JSON numbers. */
export function toBranch(row: BranchRow): Branch {
  const { orgId: _internal, latitude, longitude, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    latitude: latitude === null ? null : Number(latitude),
    longitude: longitude === null ? null : Number(longitude),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

const coordinate = (value: number | null) => (value === null ? null : value.toFixed(6));

export async function findOrg(tx: Tx, orgId: string): Promise<OrgRow | undefined> {
  return tx.query.organization.findFirst({ where: (o, { eq }) => eq(o.id, orgId) });
}

/** Locks the organization row, then reads it; serializes concurrent PATCH /org so each audit diff is exact. */
export async function lockOrg(tx: Tx, orgId: string): Promise<OrgRow | undefined> {
  await transactionQuery(tx)`SELECT id FROM organization WHERE id = ${orgId} FOR UPDATE`;
  return findOrg(tx, orgId);
}

export async function updateOrg(tx: Tx, orgId: string, f: OrgFields, now: Date): Promise<OrgRow> {
  await transactionQuery(tx)`
    UPDATE organization SET display_name = ${f.displayName}, legal_name = ${f.legalName}, tax_id = ${f.taxId}, phone = ${f.phone},
           receipt_footer = ${f.receiptFooter}, updated_at = ${now}
     WHERE id = ${orgId}`;
  const row = await findOrg(tx, orgId);
  if (!row) throw new Error("updateOrg: the organization vanished inside its own transaction");
  return row;
}

/** #rule-branch-list: createdAt asc, then id asc; `scope` null = organization-wide (F02). */
export async function listBranches(tx: Tx, scope: readonly string[] | null): Promise<BranchRow[]> {
  return tx.query.branch.findMany({
    ...(scope === null ? {} : { where: (b, { inArray }) => inArray(b.id, [...scope]) }),
    orderBy: (b, { asc }) => [asc(b.createdAt), asc(b.id)],
  });
}

/** #rule-branch-capacity counts every branch of the organization, active or not. */
export async function countBranches(tx: Tx): Promise<number> {
  return tx.$count(branch);
}

export async function insertBranch(tx: Tx, orgId: string, f: Omit<BranchFields, "isActive">, now: Date): Promise<BranchRow> {
  const [row] = await tx
    .insert(branch)
    .values({
      orgId,
      name: f.name,
      address: f.address,
      phone: f.phone,
      latitude: coordinate(f.latitude),
      longitude: coordinate(f.longitude),
      timezone: BRANCH_TIMEZONE,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("insertBranch: the branch insert returned no row");
  return row;
}

export async function insertDefaultHours(tx: Tx, orgId: string, branchId: string): Promise<void> {
  await tx.insert(branchHours).values(WEEKDAYS.map((weekday) => ({ orgId, branchId, weekday, opensAt: "09:00:00", closesAt: "18:00:00" })));
}

/** Locks the branch row, then reads it; undefined when absent or of another organization (RLS). */
export async function lockBranch(tx: Tx, branchId: string): Promise<BranchRow | undefined> {
  const { rows } = await transactionQuery(tx)`SELECT id FROM branch WHERE id = ${branchId} FOR UPDATE`;
  if (rows.length === 0) return undefined;
  return tx.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, branchId) });
}

/** #rule-branch-version: the increment happens in the UPDATE itself and the new value comes from RETURNING. */
export async function updateBranch(tx: Tx, branchId: string, f: BranchFields, now: Date): Promise<BranchRow> {
  const { rows } = await transactionQuery(tx)<{ version: number }>`
    UPDATE branch SET name = ${f.name}, address = ${f.address}, phone = ${f.phone}, latitude = ${coordinate(f.latitude)},
           longitude = ${coordinate(f.longitude)}, is_active = ${f.isActive}, version = version + 1, updated_at = ${now}
     WHERE id = ${branchId} RETURNING version`;
  const row = await tx.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, branchId) });
  if (!row || !rows[0]) throw new Error("updateBranch: the locked branch vanished inside its own transaction");
  return { ...row, version: rows[0].version };
}

/** #rule-branch-payment-settings-write: value + version + updated_at in one statement; no other column changes. */
export async function updateBranchPromptpay(tx: Tx, branchId: string, promptpayId: string | null, now: Date): Promise<BranchRow> {
  const { rows } = await transactionQuery(tx)<{ version: number }>`
    UPDATE branch SET promptpay_id = ${promptpayId}, version = version + 1, updated_at = ${now} WHERE id = ${branchId} RETURNING version`;
  const row = await tx.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, branchId) });
  if (!row || !rows[0]) throw new Error("updateBranchPromptpay: the locked branch vanished inside its own transaction");
  return { ...row, version: rows[0].version };
}

/** Postgres unique violation on `constraint`; drizzle wraps the pg error in `cause`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let e = error as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; e && typeof e === "object" && depth < 5; depth++, e = e.cause as typeof e) {
    if (e.code === "23505" && e.constraint === constraint) return true;
  }
  return false;
}
