import type { Db } from "@app/db";
import { Module } from "@nestjs/common";
import type Valkey from "iovalkey";
import { CONFIG } from "../../common/context";
import { PLATFORM_DB, VALKEY } from "../../common/db";
import type { Config } from "../../config";
import { EMAIL_SENDER, EmailModule, type EmailSender } from "../notification/email";
import { AUTH, createAuth } from "./auth";
import { AuthGuard } from "./auth.guard";
import { BACKGROUND, BackgroundWork } from "./background";
import { IdentityController } from "./identity.controller";
import {
  FORGOT_LIMITER,
  forgotLimiter,
  LOGIN_LIMITER,
  loginLimiter,
  RESEND_LIMITER,
  resendLimiter,
  SIGNUP_LIMITER,
  signupLimiter,
} from "./rate-limit";

@Module({
  imports: [EmailModule],
  controllers: [IdentityController],
  providers: [
    {
      provide: AUTH,
      inject: [CONFIG, PLATFORM_DB, EMAIL_SENDER],
      useFactory: (config: Config, db: Db, email: EmailSender) => createAuth(config, db, email),
    },
    { provide: LOGIN_LIMITER, inject: [VALKEY], useFactory: (valkey: Valkey) => loginLimiter(valkey) },
    { provide: FORGOT_LIMITER, inject: [VALKEY], useFactory: (valkey: Valkey) => forgotLimiter(valkey) },
    { provide: SIGNUP_LIMITER, inject: [VALKEY], useFactory: signupLimiter },
    { provide: RESEND_LIMITER, inject: [VALKEY], useFactory: resendLimiter },
    { provide: BACKGROUND, useValue: new BackgroundWork() },
    AuthGuard,
  ],
  exports: [AUTH, AuthGuard, SIGNUP_LIMITER, RESEND_LIMITER],
})
export class IdentityModule {}
