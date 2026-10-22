import { z } from "zod";
import { Closure } from "./branch.closure.create";
import { strictBody } from "./fields";

// docs/spec/features/foundation.md#contract-branch-closures — every record of the branch, no filter/pagination,
// ordered startDate, endDate, id.
export const BranchClosureListResponse = z.strictObject({ items: z.array(Closure) });
export type BranchClosureListResponse = z.infer<typeof BranchClosureListResponse>;

// #contract-branch-schedule-common: path ids reported by name; no route accepts any query key.
export const BranchScheduleParams = z.strictObject({ branchId: z.uuid() });
export const ScheduleQuery = strictBody({});
