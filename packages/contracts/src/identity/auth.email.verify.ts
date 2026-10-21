import { z } from "zod";

// foundation#rule-email-verification-http: JSON token only; callbacks/cookies are never forwarded.
export const AuthEmailVerifyRequest = z.object({ token: z.string().min(1) });
export type AuthEmailVerifyRequest = z.infer<typeof AuthEmailVerifyRequest>;
export const AUTH_EMAIL_VERIFY_STATUS = 204;
