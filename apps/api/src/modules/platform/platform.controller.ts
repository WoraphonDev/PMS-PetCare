import {
  type PlatformOrgDetail,
  PlatformOrgIdParam,
  PlatformOrgListQuery,
  type PlatformOrgListResponse,
  PlatformOrgSetStatusRequest,
} from "@app/contracts";
import type { Db } from "@app/db";
import { Body, Controller, Get, Inject, Param, Put, Query, Req, UseGuards } from "@nestjs/common";
import { CLOCK, type Clock } from "../../common/context";
import { PLATFORM_DB, RUNTIME_DB } from "../../common/db";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodBody } from "../../common/zod.pipe";
import type { AuthedRequest } from "../identity";
import type { PlatformContext } from "./context";
import { platformOrgGet } from "./use-cases/platform.org.get";
import { platformOrgList } from "./use-cases/platform.org.list";
import { platformOrgSetStatus } from "./use-cases/platform.org.set_status";

const orgIdParam = new ZodBody(PlatformOrgIdParam.transform((id) => id.toLowerCase()));

// foundation#rule-platform-module: platform admin with 2FA on this session; no X-Org-Id; F04 does not apply.
@Controller("platform/orgs")
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    @Inject(PLATFORM_DB) private readonly platformDb: Db,
    @Inject(RUNTIME_DB) private readonly runtimeDb: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query(new ZodBody(PlatformOrgListQuery)) query: PlatformOrgListQuery): Promise<PlatformOrgListResponse> {
    return platformOrgList(this.ctx(req), query);
  }

  @Get(":orgId")
  get(@Req() req: AuthedRequest, @Param("orgId", orgIdParam) orgId: string): Promise<PlatformOrgDetail> {
    return platformOrgGet(this.ctx(req), orgId);
  }

  @Put(":orgId/status")
  setStatus(
    @Req() req: AuthedRequest,
    @Param("orgId", orgIdParam) orgId: string,
    @Body(new ZodBody(PlatformOrgSetStatusRequest)) body: PlatformOrgSetStatusRequest,
  ): Promise<PlatformOrgDetail> {
    return platformOrgSetStatus(this.ctx(req), orgId, body);
  }

  private ctx(req: AuthedRequest): PlatformContext {
    if (!req.user) throw new Error("PlatformController: the guard did not set the user");
    return { platformDb: this.platformDb, runtimeDb: this.runtimeDb, adminUserId: req.user.id, now: this.clock.now() };
  }
}
