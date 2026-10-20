import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { AuthedRequest, UserRow } from "../modules/identity";
import { AppError } from "./app-error";

export const REQUEST_SESSION = Symbol("REQUEST_SESSION");
export interface SessionRequest extends AuthedRequest {
  method: string;
  routeOptions: { url: string };
  resolvedSession?: Promise<UserRow | null>;
}
export type ResolveSession = (req: SessionRequest) => Promise<UserRow | null>;

/** Supplied by identity's public module: common infrastructure never queries identity tables. */
export function sessionResolver(
  lookup: (headers: AuthedRequest["headers"]) => Promise<{ user: UserRow; sessionId: string } | null>,
): ResolveSession {
  return (req) => {
    req.resolvedSession ??= lookup(req.headers).then((found) => {
      if (!found) return null;
      req.user = found.user;
      req.sessionId = found.sessionId;
      return found.user;
    });
    return req.resolvedSession;
  };
}

const PASSWORD_EXCEPTIONS = new Set(["POST /api/v1/auth/password/change", "POST /api/v1/auth/logout", "GET /api/v1/me", "HEAD /api/v1/me"]);

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(@Inject(REQUEST_SESSION) private readonly resolve: ResolveSession) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    // Public probes/liveness remain independent of database availability when no credentials are supplied.
    if (!req.headers.cookie && !req.headers.authorization) return true;
    const user = await this.resolve(req);
    if (user?.mustChangePassword && !PASSWORD_EXCEPTIONS.has(`${req.method} ${req.routeOptions.url}`)) {
      throw new AppError("PASSWORD_CHANGE_REQUIRED");
    }
    return true;
  }
}
