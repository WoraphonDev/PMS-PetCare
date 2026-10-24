import {
  AuthEmailVerificationResendRequest,
  AuthEmailVerifyRequest,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthPasswordChangeRequest,
  AuthPasswordForgotRequest,
  AuthPasswordResetRequest,
  AuthSignupRequest,
  AuthSignupResponse,
  AuthTwoFactorVerifyRequest,
  MeResponse,
} from "@app/contracts";
import { defineEndpoint } from "../client";

// foundation §5 endpoints, alphabetical (one export each).
export const authEmailVerificationResend = defineEndpoint({
  method: "POST",
  path: "/auth/email/verification/resend",
  response: null,
  body: AuthEmailVerificationResendRequest,
});
export const authEmailVerify = defineEndpoint({ method: "POST", path: "/auth/email/verify", response: null, body: AuthEmailVerifyRequest });
export const authLogin = defineEndpoint({ method: "POST", path: "/auth/login", response: AuthLoginResponse, body: AuthLoginRequest });
export const authPasswordChange = defineEndpoint({
  method: "POST",
  path: "/auth/password/change",
  response: null,
  body: AuthPasswordChangeRequest,
});
export const authPasswordForgot = defineEndpoint({
  method: "POST",
  path: "/auth/password/forgot",
  response: null,
  body: AuthPasswordForgotRequest,
});
export const authPasswordReset = defineEndpoint({
  method: "POST",
  path: "/auth/password/reset",
  response: null,
  body: AuthPasswordResetRequest,
});
export const authSignup = defineEndpoint({ method: "POST", path: "/auth/signup", response: AuthSignupResponse, body: AuthSignupRequest });
export const authTwoFactorVerify = defineEndpoint({
  method: "POST",
  path: "/auth/2fa/verify",
  response: null,
  body: AuthTwoFactorVerifyRequest,
});
export const meGet = defineEndpoint({ method: "GET", path: "/me", response: MeResponse });
