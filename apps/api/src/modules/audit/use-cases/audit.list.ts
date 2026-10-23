import { AUDIT_PAGE_SIZE, type AuditListQuery, type AuditListResponse } from "@app/contracts";
import type { OrgRequestContext } from "../../../common/context";
import { staffProfiles } from "../../identity";
import { memberNames } from "../../org";
import { auditPage } from "../audit.repository";
import { decodeCursor, encodeCursor } from "../cursor";

/**
 * docs/spec/features/foundation.md#contract-audit-list — newest first, 50 per page. `actor.displayName` is the actor's
 * membership name in this shop (removed members too), else the account name; `ip` / `userAgent` are never returned.
 */
export async function auditList(ctx: OrgRequestContext, query: AuditListQuery, secret: string): Promise<AuditListResponse> {
  const cursor = query.cursor === undefined ? null : decodeCursor(secret, ctx.org.id, query.cursor);
  return ctx.db.run(async (tx) => {
    const rows = await auditPage(
      tx,
      {
        orgId: ctx.org.id,
        from: query.from ?? null,
        to: query.to ?? null,
        action: query.action ?? null,
        actorUserId: query.actorUserId ?? null,
        cursor,
      },
      AUDIT_PAGE_SIZE + 1,
    );
    const items = rows.slice(0, AUDIT_PAGE_SIZE);
    const actorIds = [...new Set(items.flatMap((r) => (r.actor_user_id ? [r.actor_user_id] : [])))];
    const names = await memberNames(tx, actorIds);
    const missing = actorIds.filter((id) => !names.has(id));
    for (const profile of await staffProfiles(tx, missing)) names.set(profile.id, profile.name);
    const last = items.at(-1);
    return {
      items: items.map((r) => ({
        id: r.id,
        occurredAt: new Date(r.occurred_at).toISOString(),
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        actor: r.actor_user_id ? { userId: r.actor_user_id, displayName: names.get(r.actor_user_id) ?? "" } : null,
        before: r.before,
        after: r.after,
      })),
      nextCursor:
        rows.length > AUDIT_PAGE_SIZE && last ? encodeCursor(secret, ctx.org.id, { occurredAt: last.occurred_at_text, id: last.id }) : null,
    };
  });
}
