import { z } from "zod";

// docs/spec/features/foundation.md#contract-branch-closures — item route only; 204 without body, repeat → NOT_FOUND.
export const BranchClosureParams = z.strictObject({ branchId: z.uuid(), closureId: z.uuid() });
export type BranchClosureParams = z.infer<typeof BranchClosureParams>;
export const BRANCH_CLOSURE_DELETE_STATUS = 204;
