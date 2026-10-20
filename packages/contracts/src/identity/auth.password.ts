import { z } from "zod";
import { Password } from "./password";

// docs/spec/features/foundation.md#ep-auth.password_forgot — always 204 (does not reveal whether the email exists).
export const AuthPasswordForgotRequest = z.object({ email: z.email().max(254) });
export type AuthPasswordForgotRequest = z.infer<typeof AuthPasswordForgotRequest>;

// #ep-auth.password_reset — token from the emailed link; invalid / expired / used → VALIDATION_FAILED on `token` (F11).
export const AuthPasswordResetRequest = z.object({ token: z.string().min(1).max(256), password: Password });
export type AuthPasswordResetRequest = z.infer<typeof AuthPasswordResetRequest>;

// #ep-auth.password_change — the current password is only presented, so it is not length-checked beyond the max.
export const AuthPasswordChangeRequest = z.object({ currentPassword: z.string().min(1).max(128), newPassword: Password });
export type AuthPasswordChangeRequest = z.infer<typeof AuthPasswordChangeRequest>;

/** All three respond 204 with no body. */
export const AUTH_PASSWORD_STATUS = 204;
