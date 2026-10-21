import {
  AuthEmailVerificationResendRequest,
  AuthEmailVerifyRequest,
  AuthLoginRequest,
  type AuthLoginResponse,
  AuthPasswordChangeRequest,
  AuthPasswordForgotRequest,
  AuthPasswordResetRequest,
  AuthTwoFactorDisableRequest,
  AuthTwoFactorEnableRequest,
  AuthTwoFactorVerifyRequest,
  type MeResponse,
} from "@app/contracts";
import type { Db } from "@app/db";
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { CLOCK, type Clock, CONFIG } from "../../common/context";
import { PLATFORM_DB, RUNTIME_DB } from "../../common/db";
import { ZodBody } from "../../common/zod.pipe";
import type { Config } from "../../config";
import { EMAIL_SENDER, type EmailSender } from "../notification/email";
import { AUTH, type Auth, toHeaders } from "./auth";
import { type AuthedRequest, AuthGuard } from "./auth.guard";
import { BACKGROUND, type BackgroundWork } from "./background";
import { type FailureLimiter, FORGOT_LIMITER, LOGIN_LIMITER, RESEND_LIMITER, type ResendLimiter } from "./rate-limit";
import { authEmailVerificationResend } from "./use-cases/auth.email.verification.resend";
import { authEmailVerify } from "./use-cases/auth.email.verify";
import { authLogin } from "./use-cases/auth.login";
import { authLogout } from "./use-cases/auth.logout";
import { authPasswordChange } from "./use-cases/auth.password_change";
import { authPasswordForgot } from "./use-cases/auth.password_forgot";
import { authPasswordReset } from "./use-cases/auth.password_reset";
import { authTwoFactor } from "./use-cases/auth.two-factor";
import { meGet } from "./use-cases/me.get";

interface Reply {
  header(name: string, value: string | string[]): Reply;
}

@Controller()
export class IdentityController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(RUNTIME_DB) private readonly runtimeDb: Db,
    @Inject(RESEND_LIMITER) private readonly resendLimiter: ResendLimiter,
    @Inject(PLATFORM_DB) private readonly platformDb: Db,
    @Inject(LOGIN_LIMITER) private readonly limiter: FailureLimiter,
    @Inject(FORGOT_LIMITER) private readonly forgotLimiter: FailureLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BACKGROUND) private readonly background: BackgroundWork,
  ) {}

  @Post("auth/email/verify")
  @HttpCode(204)
  async emailVerify(@Body(new ZodBody(AuthEmailVerifyRequest)) body: AuthEmailVerifyRequest): Promise<void> {
    await authEmailVerify({ now: this.clock.now() }, body, { db: this.runtimeDb, secret: this.config.BETTER_AUTH_SECRET });
  }

  @Post("auth/email/verification/resend")
  @HttpCode(204)
  async emailVerificationResend(
    @Body(new ZodBody(AuthEmailVerificationResendRequest)) body: AuthEmailVerificationResendRequest,
    @Req() req: { ip: string },
  ): Promise<void> {
    await authEmailVerificationResend({ now: this.clock.now(), ip: req.ip }, body, {
      db: this.runtimeDb,
      config: this.config,
      email: this.email,
      limiter: this.resendLimiter,
    });
  }

  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(new ZodBody(AuthLoginRequest)) body: AuthLoginRequest,
    @Req() req: AuthedRequest & { ip: string },
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<AuthLoginResponse> {
    const result = await authLogin({ ip: req.ip, headers: toHeaders(req.headers), now: this.clock.now() }, body, {
      auth: this.auth,
      platformDb: this.platformDb,
      limiter: this.limiter,
    });
    reply.header("set-cookie", result.setCookies);
    return result.body;
  }

  @Post("auth/logout")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) reply: Reply): Promise<void> {
    const { setCookies } = await authLogout({ headers: toHeaders(req.headers) }, { auth: this.auth });
    reply.header("set-cookie", setCookies);
  }

  @Post("auth/password/forgot")
  @HttpCode(204)
  async passwordForgot(
    @Body(new ZodBody(AuthPasswordForgotRequest)) body: AuthPasswordForgotRequest,
    @Req() req: { ip: string },
  ): Promise<void> {
    await authPasswordForgot({ ip: req.ip }, body, {
      auth: this.auth,
      platformDb: this.platformDb,
      limiter: this.forgotLimiter,
      background: this.background,
    });
  }

  @Post("auth/password/reset")
  @HttpCode(204)
  async passwordReset(
    @Body(new ZodBody(AuthPasswordResetRequest)) body: AuthPasswordResetRequest,
    @Req() req: AuthedRequest & { ip: string },
  ): Promise<void> {
    const ua = req.headers["user-agent"];
    await authPasswordReset({ now: this.clock.now(), ip: req.ip, userAgent: typeof ua === "string" ? ua : null }, body, {
      auth: this.auth,
      platformDb: this.platformDb,
    });
  }

  @Post("auth/password/change")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async passwordChange(
    @Body(new ZodBody(AuthPasswordChangeRequest)) body: AuthPasswordChangeRequest,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const user = req.user as NonNullable<AuthedRequest["user"]>;
    await authPasswordChange({ now: this.clock.now(), userId: user.id, sessionId: req.sessionId as string }, body, {
      auth: this.auth,
      platformDb: this.platformDb,
    });
  }

  private async twoFactor(
    op: "enable" | "verify" | "disable",
    body: { password?: string; code?: string; trustDevice?: boolean },
    req: AuthedRequest & { ip: string },
    reply: Reply,
  ) {
    const ua = req.headers["user-agent"];
    const result = await authTwoFactor(
      op,
      body,
      { headers: toHeaders(req.headers), now: this.clock.now(), ip: req.ip, userAgent: typeof ua === "string" ? ua : null },
      { platformDb: this.platformDb, config: this.config, email: this.email },
    );
    reply.header("set-cookie", result.setCookies);
    return result.body;
  }

  @Post("auth/2fa/enable")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  enableTwoFactor(
    @Body(new ZodBody(AuthTwoFactorEnableRequest)) body: { password: string },
    @Req() req: AuthedRequest & { ip: string },
    @Res({ passthrough: true }) reply: Reply,
  ) {
    return this.twoFactor("enable", body, req, reply);
  }

  @Post("auth/2fa/verify")
  @HttpCode(204)
  async verifyTwoFactor(
    @Body(new ZodBody(AuthTwoFactorVerifyRequest)) body: { code: string; trustDevice?: boolean },
    @Req() req: AuthedRequest & { ip: string },
    @Res({ passthrough: true }) reply: Reply,
  ) {
    await this.twoFactor("verify", body, req, reply);
  }

  @Post("auth/2fa/disable")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async disableTwoFactor(
    @Body(new ZodBody(AuthTwoFactorDisableRequest)) body: { password: string; code: string },
    @Req() req: AuthedRequest & { ip: string },
    @Res({ passthrough: true }) reply: Reply,
  ) {
    await this.twoFactor("disable", body, req, reply);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return meGet({ user: req.user as NonNullable<AuthedRequest["user"]> }, { platformDb: this.platformDb });
  }
}
