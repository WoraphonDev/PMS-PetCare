// Public API of identity (ADR-0002); request policy wiring lives here to keep common independent of identity internals.
import { type Db, type Tx, transactionQuery } from "@app/db";
import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CLOCK, type Clock } from "../../common/context";
import { PLATFORM_DB } from "../../common/db";
import { PasswordChangeGuard, REQUEST_SESSION, type ResolveSession, sessionResolver } from "../../common/session";
import { AUTH, type Auth, toHeaders } from "./auth";
import { IdentityModule as IdentityCoreModule } from "./identity.module";
import { findUserById } from "./identity.repository";
import { hasTwoFactorSession } from "./two-factor-session";

@Global()
@Module({
  imports: [IdentityCoreModule],
  providers: [
    {
      provide: REQUEST_SESSION,
      inject: [AUTH, PLATFORM_DB, CLOCK],
      useFactory: (auth: Auth, db: Db, clock: Clock): ResolveSession => {
        const resolve = sessionResolver(async (headers) => {
          const found = await auth.api.getSession({ headers: toHeaders(headers) });
          if (!found) return null;
          const user = await findUserById(db, found.user.id);
          if (user?.twoFactorEnabled && !(await hasTwoFactorSession(db, found.session.id, user.id, clock.now()))) return null;
          return user ? { user, sessionId: found.session.id } : null;
        });
        return (req) => {
          // These public JSON operations never consult/refresh a supplied session or accept a callback URL.
          if (
            req.method === "POST" &&
            [
              "/api/v1/auth/signup",
              "/api/v1/auth/signup/invitation",
              "/api/v1/auth/email/verify",
              "/api/v1/auth/email/verification/resend",
              "/api/v1/invitations/preview",
            ].includes(req.routeOptions.url)
          )
            return Promise.resolve(null);
          return resolve(req);
        };
      },
    },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
  ],
  exports: [IdentityCoreModule, REQUEST_SESSION],
})
export class IdentityModule {}

export { AUTH, type Auth, createAuth, toHeaders } from "./auth";
export { type AuthedRequest, AuthGuard } from "./auth.guard";
export { BACKGROUND, BackgroundWork } from "./background";
export type { UserRow } from "./identity.repository";
export { createEmailVerificationRepository } from "./identity.repository";
export {
  createManagedAccount,
  deleteAllSessions,
  hashPassword,
  managedOwnerOf,
  setManagedPassword,
  usernameTaken,
} from "./managed-account";
export {
  FailureLimiter,
  RESEND_LIMITER,
  type ResendLimiter,
  resendLimiter,
  SIGNUP_LIMITER,
  type SignupLimiter,
  signupLimiter,
} from "./rate-limit";
export { type StaffProfile, staffProfiles, usersByEmail } from "./staff-directory";
export { hasTwoFactorSession, platformSession } from "./two-factor-session";
export { captureVerificationAfterCommit } from "./verification-collector";
export { captureSignupVerification } from "./verification-email";

/**
 * foundation#contract-platform-org-read (T-0019-01 B): ids of real-email users whose email contains `q`, ignoring case.
 * Managed accounts never match — their `<id>@managed.invalid` placeholder is not an address. Platform connection only.
 */
export async function userIdsByEmailPart(tx: Tx, q: string): Promise<string[]> {
  const { rows } = await transactionQuery(tx)<{ id: string }>`
    SELECT id FROM "user" WHERE NOT is_managed AND position(lower(${q}::text) IN lower(email)) > 0`;
  return rows.map((r) => r.id);
}
