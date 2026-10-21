// Public API of identity (ADR-0002); request policy wiring lives here to keep common independent of identity internals.
import type { Db } from "@app/db";
import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CLOCK, type Clock } from "../../common/context";
import { PLATFORM_DB } from "../../common/db";
import { PasswordChangeGuard, REQUEST_SESSION, sessionResolver } from "../../common/session";
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
      useFactory: (auth: Auth, db: Db, clock: Clock) =>
        sessionResolver(async (headers) => {
          const found = await auth.api.getSession({ headers: toHeaders(headers) });
          if (!found) return null;
          const user = await findUserById(db, found.user.id);
          if (user?.twoFactorEnabled && !(await hasTwoFactorSession(db, found.session.id, user.id, clock.now()))) return null;
          return user ? { user, sessionId: found.session.id } : null;
        }),
    },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
  ],
  exports: [IdentityCoreModule, REQUEST_SESSION],
})
export class IdentityModule {}

export { AUTH, type Auth, toHeaders } from "./auth";
export { type AuthedRequest, AuthGuard } from "./auth.guard";
export { BACKGROUND, BackgroundWork } from "./background";
export type { UserRow } from "./identity.repository";
export { createEmailVerificationRepository } from "./identity.repository";
export {
  FailureLimiter,
  RESEND_LIMITER,
  type ResendLimiter,
  resendLimiter,
  SIGNUP_LIMITER,
  type SignupLimiter,
  signupLimiter,
} from "./rate-limit";
export { hasTwoFactorSession, platformSession } from "./two-factor-session";
export { captureVerificationAfterCommit } from "./verification-collector";
