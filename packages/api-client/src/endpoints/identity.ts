import {
  AuthEmailVerificationResendRequest,
  AuthEmailVerifyRequest,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthSignupRequest,
  AuthSignupResponse,
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
export const authSignup = defineEndpoint({ method: "POST", path: "/auth/signup", response: AuthSignupResponse, body: AuthSignupRequest });
export const meGet = defineEndpoint({ method: "GET", path: "/me", response: MeResponse });
