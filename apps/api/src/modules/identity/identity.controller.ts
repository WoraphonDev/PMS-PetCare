import {
  AuthLoginRequest,
  type AuthLoginResponse,
  AuthPasswordChangeRequest,
  AuthPasswordForgotRequest,
  AuthPasswordResetRequest,
  type MeResponse,
} from "@app/contracts";
import type { Db } from "@app/db";
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { CLOCK, type Clock } from "../../common/context";
import { PLATFORM_DB } from "../../common/db";
import { ZodBody } from "../../common/zod.pipe";
import { AUTH, type Auth, toHeaders } from "./auth";
import { type AuthedRequest, AuthGuard } from "./auth.guard";
import { type FailureLimiter, FORGOT_LIMITER, LOGIN_LIMITER } from "./rate-limit";
import { authLogin } from "./use-cases/auth.login";
import { authLogout } from "./use-cases/auth.logout";
import { authPasswordChange } from "./use-cases/auth.password_change";
import { authPasswordForgot } from "./use-cases/auth.password_forgot";
import { authPasswordReset } from "./use-cases/auth.password_reset";
import { meGet } from "./use-cases/me.get";

interface Reply {
  header(name: string, value: string | string[]): Reply;
}

@Controller()
export class IdentityController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PLATFORM_DB) private readonly platformDb: Db,
    @Inject(LOGIN_LIMITER) private readonly limiter: FailureLimiter,
    @Inject(FORGOT_LIMITER) private readonly forgotLimiter: FailureLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(new ZodBody(AuthLoginRequest)) body: AuthLoginRequest,
    @Req() req: AuthedRequest & { ip: string },
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<AuthLoginResponse> {
    const result = await authLogin({ ip: req.ip, headers: toHeaders(req.headers) }, body, {
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
    await authPasswordForgot({ ip: req.ip }, body, { auth: this.auth, platformDb: this.platformDb, limiter: this.forgotLimiter });
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
    await authPasswordChange({ headers: toHeaders(req.headers), userId: user.id }, body, {
      auth: this.auth,
      platformDb: this.platformDb,
    });
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return meGet({ user: req.user as NonNullable<AuthedRequest["user"]> }, { platformDb: this.platformDb });
  }
}
