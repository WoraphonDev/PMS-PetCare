import { type TxContext, transactionQuery } from "@app/db";

/**
 * docs/spec/features/foundation.md#rule-branch-capacity — locks the organization's subscription row
 * (`FOR UPDATE`) on the caller's tenant transaction and returns its plan's `max_branches` (null = unlimited).
 * Concurrent branch creates (and future plan changes) serialize on this lock until the caller commits, so the
 * caller must count and insert branches after this call, in the same transaction.
 *
 * Inactive or expired plans are still enforced (no lifecycle in the MVP). No subscription fails closed.
 */
export async function lockBranchLimit(ctx: TxContext): Promise<number | null> {
  const { rows } = await transactionQuery(ctx.tx)<{ max_branches: number | null }>`
    SELECT p.max_branches FROM subscription s JOIN plan p ON p.id = s.plan_id
     WHERE s.org_id = ${ctx.orgId} FOR UPDATE OF s`;
  const [row] = rows;
  if (!row) throw new Error("lockBranchLimit: the organization has no subscription");
  return row.max_branches;
}
