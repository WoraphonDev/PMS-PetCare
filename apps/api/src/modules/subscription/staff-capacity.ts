import { type TxContext, transactionQuery } from "@app/db";

/**
 * docs/spec/features/foundation.md#rule-staff-capacity · #rule-staff-check-and-lock step 1 — locks the organization's
 * subscription row (`FOR UPDATE`, the same row as {@link lockBranchLimit}) on the caller's tenant transaction and
 * returns its plan's `max_staff` (null = unlimited). Every seat-changing writer takes this lock first.
 *
 * Inactive or expired plans are still enforced (no lifecycle in the MVP). No subscription fails closed.
 */
export async function lockStaffLimit(ctx: TxContext): Promise<number | null> {
  const { rows } = await transactionQuery(ctx.tx)<{ max_staff: number | null }>`
    SELECT p.max_staff FROM subscription s JOIN plan p ON p.id = s.plan_id
     WHERE s.org_id = ${ctx.orgId} FOR UPDATE OF s`;
  const [row] = rows;
  if (!row) throw new Error("lockStaffLimit: the organization has no subscription");
  return row.max_staff;
}
