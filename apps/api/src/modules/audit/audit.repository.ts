import { type Tx, transactionQuery } from "@app/db";
import type { Position } from "./cursor";

export interface AuditRow {
  id: string;
  occurred_at: Date;
  occurred_at_text: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * #contract-audit-list keyset page on the caller's tenant transaction: `occurred_at` desc then `id` desc, strictly after
 * `cursor`, `limit` rows. The ORDER BY matches index audit_log_org_id_occurred_at_id_idx (DESC NULLS LAST). RLS already
 * hides other orgs and platform rows (`org_id` null); the explicit org_id leads the index.
 */
export async function auditPage(
  tx: Tx,
  filter: {
    orgId: string;
    from: string | null;
    to: string | null;
    action: string | null;
    actorUserId: string | null;
    cursor: Position | null;
  },
  limit: number,
): Promise<AuditRow[]> {
  const c = filter.cursor;
  const { rows } = await transactionQuery(tx)<Record<string, unknown>>`
    SELECT id, occurred_at, occurred_at::text AS occurred_at_text, action, entity_type, entity_id, actor_user_id, before, after
      FROM audit_log
     WHERE org_id = ${filter.orgId}
       AND (${filter.from}::timestamptz IS NULL OR occurred_at >= ${filter.from}::timestamptz)
       AND (${filter.to}::timestamptz IS NULL OR occurred_at < ${filter.to}::timestamptz)
       AND (${filter.action}::text IS NULL OR action = ${filter.action}::text)
       AND (${filter.actorUserId}::uuid IS NULL OR actor_user_id = ${filter.actorUserId}::uuid)
       AND (${c?.occurredAt ?? null}::timestamptz IS NULL
            OR (occurred_at, id) < (${c?.occurredAt ?? null}::timestamptz, ${c?.id ?? null}::uuid))
     ORDER BY occurred_at DESC NULLS LAST, id DESC NULLS LAST
     LIMIT ${limit}`;
  return rows as unknown as AuditRow[];
}
