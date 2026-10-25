// Thai messages, one file per screen id (foundation §7) plus `common`. Cards add one line in each block, sorted.
// registry:start
import { common } from "./common";
import { errors } from "./errors";
import { scrAuth2fa } from "./scr-auth-2fa";
import { scrAuthChangePassword } from "./scr-auth-change-password";
import { scrAuthForgot } from "./scr-auth-forgot";
import { scrAuthLogin } from "./scr-auth-login";
import { scrAuthReset } from "./scr-auth-reset";
import { scrAuthSignup } from "./scr-auth-signup";
import { scrAuthVerifyEmail } from "./scr-auth-verify-email";
import { scrOrgSwitcher } from "./scr-org-switcher";
import { scrSettingsBranch } from "./scr-settings-branch";
import { scrSettingsBranches } from "./scr-settings-branches";
import { scrSettingsOrg } from "./scr-settings-org";
import { scrStaff } from "./scr-staff";
import { shell } from "./shell";
// registry:end

export const th = {
  // registry:start
  common,
  errors,
  "scr-auth-2fa": scrAuth2fa,
  "scr-auth-change-password": scrAuthChangePassword,
  "scr-auth-forgot": scrAuthForgot,
  "scr-auth-login": scrAuthLogin,
  "scr-auth-reset": scrAuthReset,
  "scr-auth-signup": scrAuthSignup,
  "scr-auth-verify-email": scrAuthVerifyEmail,
  "scr-org-switcher": scrOrgSwitcher,
  "scr-settings-branch": scrSettingsBranch,
  "scr-settings-branches": scrSettingsBranches,
  "scr-settings-org": scrSettingsOrg,
  "scr-staff": scrStaff,
  shell,
  // registry:end
} as const;
