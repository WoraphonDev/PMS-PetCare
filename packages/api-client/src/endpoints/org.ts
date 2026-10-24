import { Branch, BranchCreateRequest, BranchListResponse, BranchUpdateRequest, Organization, OrgUpdateRequest } from "@app/contracts";
import { defineEndpoint } from "../client";

// foundation §5 org / branch endpoints (shop-scoped: callers send `orgId`), alphabetical.
export const branchCreate = defineEndpoint({ method: "POST", path: "/branches", response: Branch, body: BranchCreateRequest });
export const branchList = defineEndpoint({ method: "GET", path: "/branches", response: BranchListResponse });
export const branchUpdate = defineEndpoint({ method: "PATCH", path: "/branches/{branchId}", response: Branch, body: BranchUpdateRequest });
export const orgGet = defineEndpoint({ method: "GET", path: "/org", response: Organization });
export const orgUpdate = defineEndpoint({ method: "PATCH", path: "/org", response: Organization, body: OrgUpdateRequest });
