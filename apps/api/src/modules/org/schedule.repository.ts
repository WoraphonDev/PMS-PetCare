import type { BranchClosureCreateRequest, Closure } from "@app/contracts";
import { branchClosure, type Tx, transactionQuery } from "@app/db";

// Branch schedule children (#tbl-branch_hours, #tbl-branch_closure) on the caller's tenant transaction (RLS).
// Writers lock the parent branch first (lockBranch), the same order as branch.update (#rule-branch-schedule-outbox).

type ClosureRow = typeof branchClosure.$inferSelect;
/** Times as PostgreSQL text (HH:MM:SS[.ffffff]) so a comparison never truncates persisted precision. */
export type HoursRow = {
  id: string;
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
};

/** #contract-branch-closures DTO: no orgId; instants as canonical UTC ISO. */
export function toClosure(row: ClosureRow): Closure {
  const { orgId: _internal, createdAt, updatedAt, ...rest } = row;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

export async function listHours(tx: Tx, branchId: string): Promise<HoursRow[]> {
  const { rows } = await transactionQuery(tx)<HoursRow>`
    SELECT id, weekday, opens_at::text AS "opensAt", closes_at::text AS "closesAt"
      FROM branch_hours WHERE branch_id = ${branchId} ORDER BY weekday`;
  return rows;
}

export async function updateHoursRow(tx: Tx, id: string, opensAt: string | null, closesAt: string | null, now: Date): Promise<void> {
  await transactionQuery(tx)`UPDATE branch_hours SET opens_at = ${opensAt}, closes_at = ${closesAt}, updated_at = ${now} WHERE id = ${id}`;
}

/** #rule-branch-version for a schedule write: only version/updated_at change; basic and payment fields are untouched. */
export async function bumpBranchVersion(tx: Tx, branchId: string, now: Date): Promise<number> {
  const { rows } = await transactionQuery(tx)<{ version: number }>`
    UPDATE branch SET version = version + 1, updated_at = ${now} WHERE id = ${branchId} RETURNING version`;
  if (!rows[0]) throw new Error("bumpBranchVersion: the locked branch vanished inside its own transaction");
  return rows[0].version;
}

export async function branchExists(tx: Tx, branchId: string): Promise<boolean> {
  return (await tx.query.branch.findFirst({ columns: { id: true }, where: (b, { eq }) => eq(b.id, branchId) })) !== undefined;
}

export async function insertClosure(
  tx: Tx,
  orgId: string,
  branchId: string,
  f: BranchClosureCreateRequest,
  now: Date,
): Promise<ClosureRow> {
  const [row] = await tx
    .insert(branchClosure)
    .values({ orgId, branchId, startDate: f.startDate, endDate: f.endDate, reason: f.reason, createdAt: now, updatedAt: now })
    .returning();
  if (!row) throw new Error("insertClosure: the closure insert returned no row");
  return row;
}

/** Deletes only the closure bound to this branch (and, via RLS, this organization); false when there is none. */
export async function deleteClosure(tx: Tx, branchId: string, closureId: string): Promise<boolean> {
  const { rows } = await transactionQuery(tx)`DELETE FROM branch_closure WHERE id = ${closureId} AND branch_id = ${branchId} RETURNING id`;
  return rows.length === 1;
}

/** #contract-branch-closures: startDate, endDate, then id (PostgreSQL uuid order). */
export async function listClosures(tx: Tx, branchId: string): Promise<ClosureRow[]> {
  return tx.query.branchClosure.findMany({
    where: (c, { eq }) => eq(c.branchId, branchId),
    orderBy: (c, { asc }) => [asc(c.startDate), asc(c.endDate), asc(c.id)],
  });
}
