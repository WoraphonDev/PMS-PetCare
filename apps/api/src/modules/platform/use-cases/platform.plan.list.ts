import type { PlatformPlanListResponse } from "@app/contracts";
import { withPlatform } from "@app/db";
import { listPlans } from "../../subscription";
import type { PlatformContext } from "../context";

// docs/spec/features/foundation.md#contract-platform-plan-list (T-0020-02 A).
export async function platformPlanList(ctx: PlatformContext): Promise<PlatformPlanListResponse> {
  const plans = await withPlatform(ctx.platformDb, listPlans);
  return {
    items: plans.map((p) => ({
      code: p.code,
      name: p.name,
      maxBranches: p.maxBranches,
      maxStaff: p.maxStaff,
      priceSatangPerMonth: p.priceSatangPerMonth,
      isActive: p.isActive,
    })),
  };
}
