import { z } from "zod";

// Normalize before validation and quota consumption; malformed schema never consumes attempts.
export const AuthEmailVerificationResendRequest = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });
export type AuthEmailVerificationResendRequest = z.infer<typeof AuthEmailVerificationResendRequest>;
export const AUTH_EMAIL_VERIFICATION_RESEND_STATUS = 204;
