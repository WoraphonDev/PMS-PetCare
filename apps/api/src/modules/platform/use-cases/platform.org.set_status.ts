import type { PlatformOrgDetail, PlatformOrgSetStatusRequest } from "@app/contracts";
import { withPlatform } from "@app/db";
import { AppError } from "../../../common/app-error";
import { setOrgStatus } from "../../org";
import type { PlatformContext } from "../context";
import { loadPlatformOrgDetail } from "./platform.org.get";

/**
 * docs/spec/features/foundation.md#contract-platform-org-status (T-0019-02 A) — the write and its audit row run in the
 * shop's tenant transaction; sessions and invitations are untouched. 200 = the detail (not a detail read: no
 * `platform.org_viewed`).
 */
export async function platformOrgSetStatus(
  ctx: PlatformContext,
  orgId: string,
  input: PlatformOrgSetStatusRequest,
): Promise<PlatformOrgDetail> {
  const outcome = await setOrgStatus(ctx.runtimeDb, { orgId, ...input, actorUserId: ctx.adminUserId, now: ctx.now });
  if (outcome === "not_found") throw new AppError("NOT_FOUND");
  const detail = await withPlatform(ctx.platformDb, (tx) => loadPlatformOrgDetail(tx, orgId, ctx.now));
  if (!detail) throw new Error("platform.org.setStatus: the shop vanished after its status write");
  return detail;
}
