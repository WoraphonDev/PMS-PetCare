import { z } from "zod";
import { Organization } from "../org/org.get";

// docs/spec/features/foundation.md#contract-platform-org-read — the detail; also the 200 body of platform.org.setStatus.
export const PlatformOrgIdParam = z.uuid();

export const PlatformOrgDetail = z.strictObject({
  organization: Organization,
  subscription: z.strictObject({
    plan: z.strictObject({
      code: z.string(),
      name: z.string(),
      maxBranches: z.number().int().nullable(),
      maxStaff: z.number().int().nullable(),
      priceSatangPerMonth: z.number().int(),
      isActive: z.boolean(),
    }),
    startedAt: z.iso.datetime(),
    currentPeriodEnd: z.iso.datetime().nullable(),
    note: z.string().nullable(),
  }),
  usage: z.strictObject({
    branches: z.number().int(),
    staff: z.strictObject({ active: z.number().int(), pendingInvitations: z.number().int(), total: z.number().int() }),
  }),
  // Active owner memberships; `email` is null for managed accounts.
  owners: z.array(
    z.strictObject({ userId: z.uuid(), displayName: z.string(), email: z.string().nullable(), username: z.string().nullable() }),
  ),
});
export type PlatformOrgDetail = z.infer<typeof PlatformOrgDetail>;
