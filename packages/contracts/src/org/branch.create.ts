import type { z } from "zod";
import { coordinatePair, Latitude, Longitude, strictBody, Text } from "./fields";

// docs/spec/features/foundation.md#contract-branch — omitted optional fields are stored as null.
export const BranchCreateRequest = strictBody({
  name: Text(100),
  address: Text(500).nullable().default(null),
  phone: Text(100).nullable().default(null),
  latitude: Latitude.optional(),
  longitude: Longitude.optional(),
})
  .superRefine(coordinatePair)
  .transform((body) => ({ ...body, latitude: body.latitude ?? null, longitude: body.longitude ?? null }));
export type BranchCreateRequest = z.infer<typeof BranchCreateRequest>;
export const BRANCH_CREATE_STATUS = 201;
