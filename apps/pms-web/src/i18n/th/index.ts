// Thai messages, one file per screen id (foundation §7) plus `common`. Cards add one line in each block, sorted.
// registry:start
import { common } from "./common";
import { errors } from "./errors";
import { scrAuthLogin } from "./scr-auth-login";
import { scrAuthSignup } from "./scr-auth-signup";
import { scrAuthVerifyEmail } from "./scr-auth-verify-email";
// registry:end

export const th = {
  // registry:start
  common,
  errors,
  "scr-auth-login": scrAuthLogin,
  "scr-auth-signup": scrAuthSignup,
  "scr-auth-verify-email": scrAuthVerifyEmail,
  // registry:end
} as const;
