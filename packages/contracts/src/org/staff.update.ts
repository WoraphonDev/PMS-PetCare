import type { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { notEmpty, strictBody, Text } from "./fields";
import { BranchIds, roleBranchRules } from "./staff.invite";

// docs/spec/features/foundation.md#contract-staff-update — PATCH with at least one field. Rules that need the target's
// current role (BRANCH_REQUIRED, branches for an owner/manager target — T-0017-04) are the use case's.
export const StaffUpdateRequest = strictBody({
  displayName: Text(100).optional(),
  role: StaffRole.optional(),
  branchIds: BranchIds.optional(),
}).superRefine((value, ctx) => {
  notEmpty(value, ctx);
  roleBranchRules(value, ctx);
});
export type StaffUpdateRequest = z.infer<typeof StaffUpdateRequest>;
export const STAFF_UPDATE_STATUS = 200;
