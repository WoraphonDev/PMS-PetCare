import type { PlatformOrgDetail, PlatformOrgSetPlanRequest } from "@app/contracts";
import { withPlatform } from "@app/db";
import { AppError } from "../../../common/app-error";
import { orgWithOwners } from "../../org";
import { changeSubscription } from "../../subscription";
import type { PlatformContext } from "../context";
import { loadPlatformOrgDetail } from "./platform.org.get";

/**
 * docs/spec/features/foundation.md#contract-platform-set-plan (T-0020-01 A) — the write runs in the shop's tenant
 * transaction (subscription). An unknown shop is NOT_FOUND; a shop without a subscription fails closed (INTERNAL).
 * 200 = the detail (not a detail read: no `platform.org_viewed`).
 */
export async function platformOrgSetPlan(
  ctx: PlatformContext,
  orgId: string,
  input: PlatformOrgSetPlanRequest,
): Promise<PlatformOrgDetail> {
  const outcome = await changeSubscription(ctx.runtimeDb, { orgId, ...input, actorUserId: ctx.adminUserId, now: ctx.now });
  if (outcome === "no_subscription") {
    if (!(await withPlatform(ctx.platformDb, (tx) => orgWithOwners(tx, orgId)))) throw new AppError("NOT_FOUND");
    throw new Error("platform.org.setPlan: the shop has no subscription");
  }
  const detail = await withPlatform(ctx.platformDb, (tx) => loadPlatformOrgDetail(tx, orgId, ctx.now));
  if (!detail) throw new Error("platform.org.setPlan: the shop vanished after its subscription write");
  return detail;
}
