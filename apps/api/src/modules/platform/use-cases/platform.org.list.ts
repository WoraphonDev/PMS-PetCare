import { PLATFORM_ORG_PAGE_SIZE, type PlatformOrgListQuery, type PlatformOrgListResponse } from "@app/contracts";
import { withPlatform } from "@app/db";
import { userIdsByEmailPart } from "../../identity";
import { searchOrgs, usageOf } from "../../org";
import { subscriptionsOf } from "../../subscription";
import type { PlatformContext } from "../context";
import { decodeCursor, encodeCursor } from "../cursor";

/**
 * docs/spec/features/foundation.md#contract-platform-org-read (T-0019-01 B) — 50 per page, newest first; usage counted
 * like the limit rules. Not audited (#rule-platform-module). A shop without a subscription fails closed (INTERNAL).
 */
export async function platformOrgList(ctx: PlatformContext, query: PlatformOrgListQuery): Promise<PlatformOrgListResponse> {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  return withPlatform(ctx.platformDb, async (tx) => {
    const q = query.q ?? null;
    const ownerUserIds = q === null ? [] : await userIdsByEmailPart(tx, q);
    const rows = await searchOrgs(tx, { q, ownerUserIds, status: query.status ?? null, after }, PLATFORM_ORG_PAGE_SIZE + 1);
    const page = rows.slice(0, PLATFORM_ORG_PAGE_SIZE);
    const ids = page.map((r) => r.id);
    const subscriptions = await subscriptionsOf(tx, ids);
    const usage = await usageOf(tx, ids, ctx.now);
    const items = page.map((r) => {
      const current = subscriptions.get(r.id);
      const counts = usage.get(r.id);
      if (!current || !counts) throw new Error("platform.org.list: a shop has no subscription");
      return {
        id: r.id,
        slug: r.slug,
        displayName: r.displayName,
        status: r.status,
        plan: { code: current.plan.code, name: current.plan.name },
        usage: { branches: counts.branches, staff: counts.staff.total },
        createdAt: r.createdAt.toISOString(),
      };
    });
    const last = page.at(-1);
    return { items, nextCursor: rows.length > PLATFORM_ORG_PAGE_SIZE && last ? encodeCursor(last.position) : null };
  });
}
