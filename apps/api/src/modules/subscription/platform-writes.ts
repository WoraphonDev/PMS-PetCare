import { type Db, transactionQuery, withTenant, writeAudit } from "@app/db";
import { AppError } from "../../common/app-error";

export interface SubscriptionChange {
  orgId: string;
  planCode: string;
  /** ISO instant as sent, or null; Postgres compares it as `timestamptz` (microseconds), so it is not rounded here. */
  currentPeriodEnd: string | null;
  note: string | null;
  actorUserId: string;
  now: Date;
}

// Audit text of `current_period_end` with Postgres' full precision (microseconds), UTC: a JS Date would drop them.
const ISO_UTC = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/**
 * docs/spec/features/foundation.md#contract-platform-set-plan (T-0020-01 A), in the shop's tenant transaction: lock the
 * subscription row first (the row of #rule-branch-capacity / #rule-staff-check-and-lock step 1), then check the plan.
 * Nothing changed → nothing written; `started_at = now` only on a plan change; `platform.plan_changed` only when
 * `planCode` or `currentPeriodEnd` changed, with those fields only — never `note`. Limits are not checked (downgrade
 * below usage is allowed; F05 blocks new additions).
 */
export function changeSubscription(runtimeDb: Db, input: SubscriptionChange): Promise<"no_subscription" | "unchanged" | "changed"> {
  return withTenant(runtimeDb, input.orgId, async (tx) => {
    const sql = transactionQuery(tx);
    // The row alone, then its plan: a join here would drop the row after waiting behind another plan change (plan-lock.ts).
    const { rows: locked } = await sql<{
      id: string;
      plan_id: string;
      period_text: string | null;
      note: string | null;
      period_changed: boolean;
    }>`
      SELECT id, plan_id, to_char(current_period_end AT TIME ZONE 'UTC', ${ISO_UTC}) AS period_text, note,
             current_period_end IS DISTINCT FROM ${input.currentPeriodEnd}::timestamptz AS period_changed
        FROM subscription WHERE org_id = ${input.orgId} FOR UPDATE`;
    const [sub] = locked;
    if (!sub) return "no_subscription";
    const { rows: plans } = await sql<{ id: string }>`SELECT id FROM plan WHERE code = ${input.planCode} AND is_active`;
    const [target] = plans;
    if (!target) throw new AppError("VALIDATION_FAILED", "Invalid request", { fields: { planCode: ["Unknown or inactive plan"] } });
    const planChanged = target.id !== sub.plan_id;
    if (!planChanged && !sub.period_changed && sub.note === input.note) return "unchanged";
    const { rows: updated } = await sql<{ period_text: string | null }>`
      UPDATE subscription
         SET plan_id = ${target.id}, current_period_end = ${input.currentPeriodEnd}::timestamptz, note = ${input.note},
             started_at = CASE WHEN ${planChanged}::boolean THEN ${input.now}::timestamptz ELSE started_at END,
             updated_at = ${input.now}
       WHERE id = ${sub.id}
   RETURNING to_char(current_period_end AT TIME ZONE 'UTC', ${ISO_UTC}) AS period_text`;
    if (planChanged || sub.period_changed) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (planChanged) {
        const { rows: current } = await sql<{ code: string }>`SELECT code FROM plan WHERE id = ${sub.plan_id}`;
        [before.planCode, after.planCode] = [current[0]?.code ?? null, input.planCode];
      }
      if (sub.period_changed) {
        [before.currentPeriodEnd, after.currentPeriodEnd] = [sub.period_text, updated[0]?.period_text ?? null];
      }
      // entity: the subscription row — T-0020-03 (open) asks the human to confirm.
      await writeAudit(tx, {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        action: "platform.plan_changed",
        entityType: "subscription",
        entityId: sub.id,
        before,
        after,
        occurredAt: input.now,
      });
    }
    return "changed";
  });
}
