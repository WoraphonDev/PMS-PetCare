import { type TxContext, transactionQuery } from "@app/db";

/**
 * Locks the organization's subscription row (`FOR UPDATE`) on the caller's tenant transaction, then reads its plan's
 * limits in a second statement. One `SELECT … JOIN plan … FOR UPDATE OF s` is not enough: when it waits behind a plan
 * change (platform.org.setPlan, #contract-platform-set-plan), READ COMMITTED re-checks the join against the old plan
 * row, the updated row drops out, and the shop looks as if it had no subscription. Undefined when there is none.
 */
export async function lockPlanLimits(ctx: TxContext): Promise<{ maxBranches: number | null; maxStaff: number | null } | undefined> {
  const sql = transactionQuery(ctx.tx);
  const { rows: subs } = await sql<{ plan_id: string }>`SELECT plan_id FROM subscription WHERE org_id = ${ctx.orgId} FOR UPDATE`;
  const [sub] = subs;
  if (!sub) return undefined;
  const { rows: plans } = await sql<{ max_branches: number | null; max_staff: number | null }>`
    SELECT max_branches, max_staff FROM plan WHERE id = ${sub.plan_id}`;
  const [plan] = plans;
  return plan && { maxBranches: plan.max_branches, maxStaff: plan.max_staff };
}
