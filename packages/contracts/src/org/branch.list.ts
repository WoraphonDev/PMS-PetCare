import { z } from "zod";

// docs/spec/features/foundation.md#contract-branch — no orgId; coordinates are JSON numbers or null.
export const Branch = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  promptpayId: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Branch = z.infer<typeof Branch>;

// #rule-branch-list: no pagination, createdAt asc then id asc.
export const BranchListResponse = z.strictObject({ items: z.array(Branch) });
export type BranchListResponse = z.infer<typeof BranchListResponse>;
