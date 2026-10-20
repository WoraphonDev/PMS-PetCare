import type { Db } from "@app/db";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { AppError } from "../../common/app-error";
import { CLOCK, type Clock } from "../../common/context";
import { PLATFORM_DB } from "../../common/db";
import { AUTH, type Auth, toHeaders } from "./auth";
import { findUserById, type UserRow } from "./identity.repository";
import { hasTwoFactorSession } from "./two-factor-session";

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: UserRow;
  sessionId?: string;
}

/** Requires a valid session; puts the full user row (incl. our columns) on `req.user`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PLATFORM_DB) private readonly platformDb: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const found = await this.auth.api.getSession({ headers: toHeaders(req.headers) });
    if (!found) throw new AppError("UNAUTHENTICATED", "Sign in required");
    const u = await findUserById(this.platformDb, found.user.id);
    if (!u || (u.twoFactorEnabled && !(await hasTwoFactorSession(this.platformDb, found.session.id, u.id, this.clock.now()))))
      throw new AppError("UNAUTHENTICATED", "Sign in required");
    req.user = u;
    req.sessionId = found.session.id;
    return true;
  }
}
