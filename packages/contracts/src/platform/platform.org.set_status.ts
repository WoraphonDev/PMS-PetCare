import type { z } from "zod";
import { strictBody, Text } from "../org/fields";
import { OrgStatus } from "./platform.org.list";

// docs/spec/features/foundation.md#contract-platform-org-status (T-0019-02 A): `reason` is required in both directions.
export const PlatformOrgSetStatusRequest = strictBody({ status: OrgStatus, reason: Text(500) });
export type PlatformOrgSetStatusRequest = z.infer<typeof PlatformOrgSetStatusRequest>;
