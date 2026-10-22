import {
  BRANCH_CLOSURE_CREATE_STATUS,
  BRANCH_CLOSURE_DELETE_STATUS,
  BRANCH_CREATE_STATUS,
  BRANCH_HOURS_PUT_STATUS,
  type Branch,
  BranchClosureCreateRequest,
  type BranchClosureListResponse,
  BranchClosureParams,
  BranchCreateRequest,
  BranchHoursPutRequest,
  type BranchHoursPutResponse,
  BranchIdParam,
  type BranchListResponse,
  BranchPaymentSettingsUpdateRequest,
  BranchScheduleParams,
  BranchUpdateRequest,
  type Closure,
  type Organization,
  OrgUpdateRequest,
  ScheduleQuery,
} from "@app/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { OrgRequestContext } from "../../common/context";
import { OrgScoped, RequirePermission } from "../../common/tenant.guard";
import { assertNoBody, type NoBodyRequest, OrgBody } from "./org-body.pipe";
import { branchClosureCreate } from "./use-cases/branch.closure.create";
import { branchClosureDelete } from "./use-cases/branch.closure.delete";
import { branchClosureList } from "./use-cases/branch.closure.list";
import { branchCreate } from "./use-cases/branch.create";
import { branchHoursPut } from "./use-cases/branch.hours.put";
import { branchList } from "./use-cases/branch.list";
import { branchPaymentSettingsUpdate } from "./use-cases/branch.payment_settings.update";
import { branchUpdate } from "./use-cases/branch.update";
import { orgGet } from "./use-cases/org.get";
import { orgUpdate } from "./use-cases/org.update";

interface Request extends NoBodyRequest {
  ctx: OrgRequestContext;
}

// #contract-branch-schedule-common: path ids reported by name and no query keys accepted on the schedule routes.
const branchParams = new OrgBody(BranchScheduleParams);
const closureParams = new OrgBody(BranchClosureParams);
const noQuery = new OrgBody(ScheduleQuery);

@Controller()
@OrgScoped()
export class OrgController {
  @Get("org")
  @RequirePermission("org.settings.read")
  get(@Req() req: Request): Promise<Organization> {
    return orgGet(req.ctx);
  }

  @Patch("org")
  @RequirePermission("org.settings.update")
  update(@Req() req: Request, @Body(new OrgBody(OrgUpdateRequest)) body: OrgUpdateRequest): Promise<Organization> {
    return orgUpdate(req.ctx, body);
  }

  @Get("branches")
  @RequirePermission("org.settings.read")
  listBranches(@Req() req: Request): Promise<BranchListResponse> {
    return branchList(req.ctx);
  }

  @Post("branches")
  @HttpCode(BRANCH_CREATE_STATUS)
  @RequirePermission("branch.create")
  createBranch(@Req() req: Request, @Body(new OrgBody(BranchCreateRequest)) body: BranchCreateRequest): Promise<Branch> {
    return branchCreate(req.ctx, body);
  }

  @Patch("branches/:branchId")
  @RequirePermission("branch.update")
  updateBranch(
    @Req() req: Request,
    @Param("branchId", new OrgBody(BranchIdParam)) branchId: string,
    @Body(new OrgBody(BranchUpdateRequest)) body: BranchUpdateRequest,
  ): Promise<Branch> {
    return branchUpdate(req.ctx, branchId.toLowerCase(), body);
  }

  @Put("branches/:branchId/payment-settings")
  @RequirePermission("branch.payment_settings.update")
  updatePaymentSettings(
    @Req() req: Request,
    @Param("branchId", new OrgBody(BranchIdParam)) branchId: string,
    @Body(new OrgBody(BranchPaymentSettingsUpdateRequest)) body: BranchPaymentSettingsUpdateRequest,
  ): Promise<Branch> {
    return branchPaymentSettingsUpdate(req.ctx, branchId.toLowerCase(), body);
  }

  @Put("branches/:branchId/hours")
  @HttpCode(BRANCH_HOURS_PUT_STATUS)
  @RequirePermission("branch.update")
  putHours(
    @Req() req: Request,
    @Param(branchParams) params: { branchId: string },
    @Query(noQuery) _query: unknown,
    @Body(new OrgBody(BranchHoursPutRequest)) body: BranchHoursPutRequest,
  ): Promise<BranchHoursPutResponse> {
    return branchHoursPut(req.ctx, params.branchId.toLowerCase(), body);
  }

  @Post("branches/:branchId/closures")
  @HttpCode(BRANCH_CLOSURE_CREATE_STATUS)
  @RequirePermission("branch.update")
  createClosure(
    @Req() req: Request,
    @Param(branchParams) params: { branchId: string },
    @Query(noQuery) _query: unknown,
    @Body(new OrgBody(BranchClosureCreateRequest)) body: BranchClosureCreateRequest,
  ): Promise<Closure> {
    return branchClosureCreate(req.ctx, params.branchId.toLowerCase(), body);
  }

  @Delete("branches/:branchId/closures/:closureId")
  @HttpCode(BRANCH_CLOSURE_DELETE_STATUS)
  @RequirePermission("branch.update")
  async deleteClosure(
    @Req() req: Request,
    @Param(closureParams) params: BranchClosureParams,
    @Query(noQuery) _query: unknown,
  ): Promise<void> {
    await assertNoBody(req);
    return branchClosureDelete(req.ctx, params.branchId.toLowerCase(), params.closureId.toLowerCase());
  }

  @Get("branches/:branchId/closures")
  @RequirePermission("org.settings.read")
  async listClosures(
    @Req() req: Request,
    @Param(branchParams) params: { branchId: string },
    @Query(noQuery) _query: unknown,
  ): Promise<BranchClosureListResponse> {
    await assertNoBody(req);
    return branchClosureList(req.ctx, params.branchId.toLowerCase());
  }
}
