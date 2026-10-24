import { z } from "zod";

// docs/spec/features/foundation.md#contract-platform-plan-list (T-0020-02 A) — every plan, by code; inactive ones too.
export const PlatformPlan = z.strictObject({
  code: z.string(),
  name: z.string(),
  maxBranches: z.number().int().nullable(),
  maxStaff: z.number().int().nullable(),
  priceSatangPerMonth: z.number().int(),
  isActive: z.boolean(),
});
export type PlatformPlan = z.infer<typeof PlatformPlan>;
export const PlatformPlanListResponse = z.strictObject({ items: z.array(PlatformPlan) });
export type PlatformPlanListResponse = z.infer<typeof PlatformPlanListResponse>;
