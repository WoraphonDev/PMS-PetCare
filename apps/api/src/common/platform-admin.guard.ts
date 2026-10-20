import type { Db } from "@app/db";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { AUTH, type Auth, type AuthedRequest, platformSession, toHeaders } from "../modules/identity";
import { AppError } from "./app-error";
import { CLOCK, type Clock } from "./context";
import { PLATFORM_DB } from "./db";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PLATFORM_DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const found = await platformSession(this.auth, this.db, toHeaders(req.headers), this.clock.now());
    if (!found) throw new AppError("UNAUTHENTICATED");
    if (!found.user.isPlatformAdmin) throw new AppError("FORBIDDEN");
    if (!found.verified) throw new AppError("TWO_FACTOR_REQUIRED");
    req.user = found.user;
    return true;
  }
}
