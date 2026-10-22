import { z } from "zod";
import { Password } from "../identity/password";
import { strictBody } from "./fields";

// docs/spec/features/foundation.md#contract-staff-password-reset — 204 without body; the password is never trimmed.
export const StaffMembershipParams = z.strictObject({ membershipId: z.uuid() });
export type StaffMembershipParams = z.infer<typeof StaffMembershipParams>;
export const StaffPasswordResetRequest = strictBody({ newPassword: Password });
export type StaffPasswordResetRequest = z.infer<typeof StaffPasswordResetRequest>;
export const STAFF_PASSWORD_RESET_STATUS = 204;
