import { AuditListQuery, type AuditListResponse } from "@app/contracts";
import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { CONFIG, type OrgRequestContext } from "../../common/context";
import { OrgScoped, RequirePermission } from "../../common/tenant.guard";
import { ZodBody } from "../../common/zod.pipe";
import type { Config } from "../../config";
import { auditList } from "./use-cases/audit.list";

@Controller()
@OrgScoped()
export class AuditController {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  @Get("audit-logs")
  @RequirePermission("audit.read")
  list(@Req() req: { ctx: OrgRequestContext }, @Query(new ZodBody(AuditListQuery)) query: AuditListQuery): Promise<AuditListResponse> {
    return auditList(req.ctx, query, this.config.BETTER_AUTH_SECRET);
  }
}
