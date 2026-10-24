import {
  type PlatformOrgDetail,
  PlatformOrgIdParam,
  PlatformOrgListQuery,
  type PlatformOrgListResponse,
  PlatformOrgSetPlanRequest,
  PlatformOrgSetStatusRequest,
  type PlatformPlanListResponse,
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
import { platformOrgSetPlan } from "./use-cases/platform.org.set_plan";
import { platformOrgSetStatus } from "./use-cases/platform.org.set_status";
import { platformPlanList } from "./use-cases/platform.plan.list";

const orgIdParam = new ZodBody(PlatformOrgIdParam.transform((id) => id.toLowerCase()));

// foundation#rule-platform-module: platform admin with 2FA on this session; no X-Org-Id; F04 does not apply.
@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    @Inject(PLATFORM_DB) private readonly platformDb: Db,
    @Inject(RUNTIME_DB) private readonly runtimeDb: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("orgs")
  list(@Req() req: AuthedRequest, @Query(new ZodBody(PlatformOrgListQuery)) query: PlatformOrgListQuery): Promise<PlatformOrgListResponse> {
    return platformOrgList(this.ctx(req), query);
  }

  @Get("orgs/:orgId")
  get(@Req() req: AuthedRequest, @Param("orgId", orgIdParam) orgId: string): Promise<PlatformOrgDetail> {
    return platformOrgGet(this.ctx(req), orgId);
  }

  @Put("orgs/:orgId/status")
  setStatus(
    @Req() req: AuthedRequest,
    @Param("orgId", orgIdParam) orgId: string,
    @Body(new ZodBody(PlatformOrgSetStatusRequest)) body: PlatformOrgSetStatusRequest,
  ): Promise<PlatformOrgDetail> {
    return platformOrgSetStatus(this.ctx(req), orgId, body);
  }

  @Put("orgs/:orgId/subscription")
  setPlan(
    @Req() req: AuthedRequest,
    @Param("orgId", orgIdParam) orgId: string,
    @Body(new ZodBody(PlatformOrgSetPlanRequest)) body: PlatformOrgSetPlanRequest,
  ): Promise<PlatformOrgDetail> {
    return platformOrgSetPlan(this.ctx(req), orgId, body);
  }

  @Get("plans")
  plans(@Req() req: AuthedRequest): Promise<PlatformPlanListResponse> {
    return platformPlanList(this.ctx(req));
  }

  private ctx(req: AuthedRequest): PlatformContext {
    if (!req.user) throw new Error("PlatformController: the guard did not set the user");
    return { platformDb: this.platformDb, runtimeDb: this.runtimeDb, adminUserId: req.user.id, now: this.clock.now() };
  }
}
