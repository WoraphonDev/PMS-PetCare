import { type Db, withTenant } from "@app/db";
import { can, isOrgWideRole, type Permission } from "@app/domain";
import { applyDecorators, type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata, UseGuards } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Config } from "../config";
import { AppError } from "./app-error";
import { CLOCK, type Clock, CONFIG, type OrgRequestContext } from "./context";
import { RUNTIME_DB } from "./db";
import { REQUEST_SESSION, type ResolveSession, type SessionRequest } from "./session";

const PERMISSION = Symbol("PERMISSION");
export interface OrgRequest extends SessionRequest {
  id: string;
  ctx?: OrgRequestContext;
}

@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    @Inject(REQUEST_SESSION) private readonly resolve: ResolveSession,
    @Inject(RUNTIME_DB) private readonly runtimeDb: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OrgRequest>();
    const user = await this.resolve(req);
    if (!user) throw new AppError("UNAUTHENTICATED");
    const id = req.headers["x-org-id"];
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError("VALIDATION_FAILED", "Invalid organization header", { fields: { "X-Org-Id": ["Expected UUID"] } });
    }
    const orgId = id.toLowerCase();
    const scoped = await withTenant(this.runtimeDb, orgId, async (tx) => {
      const member = await tx.query.membership.findFirst({
        where: (m, { and, eq }) => and(eq(m.orgId, orgId), eq(m.userId, user.id), eq(m.status, "active")),
      });
      if (!member) throw new AppError("FORBIDDEN");
      const org = await tx.query.organization.findFirst({ where: (o, { eq }) => eq(o.id, orgId) });
      if (!org) throw new AppError("FORBIDDEN");
      const assigned = await tx.query.membershipBranch.findMany({
        where: (mb, { and, eq }) => and(eq(mb.orgId, orgId), eq(mb.membershipId, member.id)),
      });
      return { org, member, branchIds: assigned.map((a) => a.branchId) };
    });
    if (scoped.org.status === "suspended" && req.method !== "GET" && req.method !== "HEAD") throw new AppError("ORG_SUSPENDED");
    req.ctx = {
      requestId: req.id,
      now: this.clock.now(),
      buildSha: this.config.BUILD_SHA,
      user,
      org: scoped.org,
      membership: { id: scoped.member.id, role: scoped.member.role, branchIds: scoped.branchIds },
      branchScope: isOrgWideRole(scoped.member.role) ? null : scoped.branchIds,
      db: { run: (fn) => withTenant(this.runtimeDb, orgId, fn) },
    };
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION, [context.getHandler(), context.getClass()]);
    const ctx = context.switchToHttp().getRequest<OrgRequest>().ctx;
    if (!ctx || !permission || !can(ctx.membership.role, permission)) throw new AppError("FORBIDDEN");
    return true;
  }
}
export function OrgScoped() {
  return UseGuards(OrgGuard);
}
export function RequirePermission(permission: Permission) {
  return applyDecorators(SetMetadata(PERMISSION, permission), UseGuards(PermissionGuard));
}
