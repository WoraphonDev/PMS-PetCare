import { z } from "zod";
import { Password } from "./password";

// docs/spec/features/foundation.md#rule-signup-input — lengths count characters like PostgreSQL char_length
// (Unicode code points), not UTF-16 units.
const Name = z
  .string()
  .trim()
  .refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= 100;
  }, "Must be 1-100 characters");

export const AuthSignupRequest = z.object({
  // Canonical lowercase, as auth.login and the resend lookup use.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: Password,
  displayName: Name,
  orgName: Name,
  // Never trimmed, lowercased or otherwise corrected.
  orgSlug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  branchName: Name,
});
export type AuthSignupRequest = z.infer<typeof AuthSignupRequest>;

export const AuthSignupResponse = z.object({ verificationRequired: z.literal(true) });
export type AuthSignupResponse = z.infer<typeof AuthSignupResponse>;
export const AUTH_SIGNUP_STATUS = 201;
