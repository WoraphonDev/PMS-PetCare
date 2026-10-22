import { z } from "zod";
import { StaffRole } from "../identity/me.get";
import { Password } from "../identity/password";
import { strictBody, Text } from "./fields";
import { BranchIds, roleBranchRules } from "./staff.invite";

// docs/spec/features/foundation.md#contract-staff-account-create — same rule as the DB CHECK user_username_format.
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, "Must be 3-40 characters of a-z, 0-9, '.', '_' or '-'");

// The password is never trimmed (F11).
export const StaffAccountCreateRequest = strictBody({
  displayName: Text(100),
  username: Username,
  password: Password,
  role: StaffRole,
  branchIds: BranchIds,
}).superRefine(roleBranchRules);
export type StaffAccountCreateRequest = z.infer<typeof StaffAccountCreateRequest>;
export const STAFF_ACCOUNT_CREATE_STATUS = 201;
