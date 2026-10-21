import { z } from "zod";
import { notEmpty, strictBody, Text } from "./fields";

// docs/spec/features/foundation.md#contract-org — slug, status, logoFileId and system fields are not writable here.
export const OrgUpdateRequest = strictBody({
  displayName: Text(100).optional(),
  legalName: Text(100).nullable().optional(),
  // 13 digits, no checksum.
  taxId: z
    .string()
    .trim()
    .regex(/^[0-9]{13}$/)
    .nullable()
    .optional(),
  phone: Text(100).nullable().optional(),
  receiptFooter: Text(500).nullable().optional(),
}).superRefine(notEmpty);
export type OrgUpdateRequest = z.infer<typeof OrgUpdateRequest>;
