import { z } from "zod";

// docs/spec/features/foundation.md#ep-auth.login — identifier is an email (contains "@") or a username.
// The login password is not length-checked (F11 applies when a password is set, not when it is presented).
export const AuthLoginRequest = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});
export type AuthLoginRequest = z.infer<typeof AuthLoginRequest>;

export const AuthLoginResponse = z.object({
  twoFactorRequired: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type AuthLoginResponse = z.infer<typeof AuthLoginResponse>;
