import { z } from "zod";

// docs/spec/features/foundation.md#contract-org — returned by GET /org and PATCH /org (200).
export const Organization = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  phone: z.string().nullable(),
  logoFileId: z.uuid().nullable(),
  receiptFooter: z.string().nullable(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof Organization>;
