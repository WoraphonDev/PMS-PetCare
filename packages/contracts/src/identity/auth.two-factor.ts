import { z } from "zod";

// foundation#ep-auth.two_factor.enable / .verify / .disable (F10).
const PresentedPassword = z.string().min(1).max(128);
const Code = z.string().min(1).max(128);
export const AuthTwoFactorEnableRequest = z.object({ password: PresentedPassword });
export const AuthTwoFactorEnableResponse = z.object({ totpUri: z.string(), backupCodes: z.array(z.string()).length(10) });
export const AuthTwoFactorVerifyRequest = z.object({ code: Code, trustDevice: z.boolean().optional() });
export const AuthTwoFactorDisableRequest = z.object({ password: PresentedPassword, code: Code });
export type AuthTwoFactorEnableResponse = z.infer<typeof AuthTwoFactorEnableResponse>;
