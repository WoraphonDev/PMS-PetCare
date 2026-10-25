import { BranchHoursPutResponse } from "./branch.hours.put";

// docs/spec/features/foundation.md#contract-branch-hours-get — the same exact projection as the PUT response (one shape for both).
export const BranchHoursGetResponse = BranchHoursPutResponse;
export type BranchHoursGetResponse = BranchHoursPutResponse;
export const BRANCH_HOURS_GET_STATUS = 200;
