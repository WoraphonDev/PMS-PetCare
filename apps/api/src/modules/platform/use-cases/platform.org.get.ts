import type { PlatformOrgDetail } from "@app/contracts";
import { type Tx, withPlatform } from "@app/db";
import { AppError } from "../../../common/app-error";
import { staffProfiles } from "../../identity";
import { orgWithOwners, recordOrgViewed, usageOf } from "../../org";
import { subscriptionsOf } from "../../subscription";
import type { PlatformContext } from "../context";

/**
 * docs/spec/features/foundation.md#contract-platform-org-read — the detail is read on the platform connection; then
 * `platform.org_viewed` is written in the shop's tenant transaction (#rule-platform-module, T-0019-04 A). A failed read
 * writes nothing; a failed audit write fails the request (INTERNAL).
 */
export async function platformOrgGet(ctx: PlatformContext, orgId: string): Promise<PlatformOrgDetail> {
  const detail = await withPlatform(ctx.platformDb, (tx) => loadPlatformOrgDetail(tx, orgId, ctx.now));
  if (!detail) throw new AppError("NOT_FOUND");
  await recordOrgViewed(ctx.runtimeDb, { orgId, actorUserId: ctx.adminUserId, now: ctx.now });
  return detail;
}

/** The detail DTO, or undefined when the shop does not exist. No subscription fails closed (INTERNAL). */
export async function loadPlatformOrgDetail(tx: Tx, orgId: string, now: Date): Promise<PlatformOrgDetail | undefined> {
  const org = await orgWithOwners(tx, orgId);
  if (!org) return undefined;
  const current = (await subscriptionsOf(tx, [orgId])).get(orgId);
  const usage = (await usageOf(tx, [orgId], now)).get(orgId);
  if (!current || !usage) throw new Error("platform.org.get: the shop has no subscription");
  const profiles = new Map(
    (
      await staffProfiles(
        tx,
        org.owners.map((o) => o.userId),
      )
    ).map((p) => [p.id, p]),
  );
  const { sub, plan } = current;
  return {
    organization: org.organization,
    subscription: {
      plan: {
        code: plan.code,
        name: plan.name,
        maxBranches: plan.maxBranches,
        maxStaff: plan.maxStaff,
        priceSatangPerMonth: plan.priceSatangPerMonth,
        isActive: plan.isActive,
      },
      startedAt: sub.startedAt.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      note: sub.note,
    },
    usage,
    owners: org.owners.flatMap((o) => {
      const profile = profiles.get(o.userId);
      return profile ? [{ userId: o.userId, displayName: o.displayName, email: profile.email, username: profile.username }] : [];
    }),
  };
}
