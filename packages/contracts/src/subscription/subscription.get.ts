import { z } from "zod";

// docs/spec/features/foundation.md#contract-subscription-get (T-0018-03 A) — no `note`, no plan `isActive`.
export const SubscriptionGetResponse = z.strictObject({
  plan: z.strictObject({
    code: z.string(),
    name: z.string(),
    maxBranches: z.number().int().nullable(),
    maxStaff: z.number().int().nullable(),
    priceSatangPerMonth: z.number().int(),
  }),
  startedAt: z.iso.datetime(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  usage: z.strictObject({
    branches: z.number().int(),
    staff: z.strictObject({ active: z.number().int(), pendingInvitations: z.number().int(), total: z.number().int() }),
  }),
});
export type SubscriptionGetResponse = z.infer<typeof SubscriptionGetResponse>;
