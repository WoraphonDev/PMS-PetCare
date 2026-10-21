import { z } from "zod";
import { coordinatePair, Latitude, Longitude, notEmpty, strictBody, Text } from "./fields";

// docs/spec/features/foundation.md#contract-branch — promptpayId (branch.paymentSettings.update), timezone, version and
// system fields are not writable here.
export const BranchUpdateRequest = strictBody({
  name: Text(100).optional(),
  address: Text(500).nullable().optional(),
  phone: Text(100).nullable().optional(),
  latitude: Latitude.optional(),
  longitude: Longitude.optional(),
  isActive: z.boolean().optional(),
})
  .superRefine(notEmpty)
  .superRefine(coordinatePair);
export type BranchUpdateRequest = z.infer<typeof BranchUpdateRequest>;

export const BranchIdParam = z.uuid();
