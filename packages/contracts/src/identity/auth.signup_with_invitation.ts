import { z } from "zod";
import { strictBody, Text } from "../org/fields";
import { StaffRole } from "./me.get";
import { Password } from "./password";

// docs/spec/features/foundation.md#contract-signup-with-invitation — no email: the account takes the invitation's.
export const AuthSignupWithInvitationRequest = strictBody({
  token: z.string().min(1).max(200),
  displayName: Text(100),
  password: Password,
});
export type AuthSignupWithInvitationRequest = z.infer<typeof AuthSignupWithInvitationRequest>;

export const AuthSignupWithInvitationResponse = z.strictObject({ orgId: z.uuid(), role: StaffRole });
export type AuthSignupWithInvitationResponse = z.infer<typeof AuthSignupWithInvitationResponse>;
export const AUTH_SIGNUP_WITH_INVITATION_STATUS = 201;
