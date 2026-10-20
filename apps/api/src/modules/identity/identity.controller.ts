import { AuthLoginRequest, type AuthLoginResponse, type MeResponse } from "@app/contracts";
import type { Db } from "@app/db";
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { PLATFORM_DB } from "../../common/db";
import { ZodBody } from "../../common/zod.pipe";
import { AUTH, type Auth, toHeaders } from "./auth";
import { type AuthedRequest, AuthGuard } from "./auth.guard";
import { type FailureLimiter, LOGIN_LIMITER } from "./rate-limit";
import { authLogin } from "./use-cases/auth.login";
import { authLogout } from "./use-cases/auth.logout";
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

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return meGet({ user: req.user as NonNullable<AuthedRequest["user"]> }, { platformDb: this.platformDb });
  }
}
