import { z } from "zod";
import { strictBody, Text } from "../org/fields";

export const OrgStatus = z.enum(["active", "suspended"]);

/**
 * docs/spec/features/foundation.md#contract-platform-org-read (T-0019-01 B): only `q`, `status` and `cursor`. `q` is
 * trimmed, 1–100 characters, and matches slug, displayName or an active owner's email. The cursor is opaque here.
 */
export const PlatformOrgListQuery = strictBody({
  q: Text(100).optional(),
  status: OrgStatus.optional(),
  cursor: z.string().min(1).max(512).optional(),
});
export type PlatformOrgListQuery = z.infer<typeof PlatformOrgListQuery>;

export const PlatformOrgSummary = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  status: OrgStatus,
  plan: z.strictObject({ code: z.string(), name: z.string() }),
  // `staff` = the #rule-staff-capacity total (active members + pending invitations).
  usage: z.strictObject({ branches: z.number().int(), staff: z.number().int() }),
  createdAt: z.iso.datetime(),
});
export type PlatformOrgSummary = z.infer<typeof PlatformOrgSummary>;
export const PlatformOrgListResponse = z.strictObject({ items: z.array(PlatformOrgSummary), nextCursor: z.string().nullable() });
export type PlatformOrgListResponse = z.infer<typeof PlatformOrgListResponse>;
export const PLATFORM_ORG_PAGE_SIZE = 50;
