import {
  BRANCH_CREATE_STATUS,
  type Branch,
  BranchCreateRequest,
  BranchIdParam,
  type BranchListResponse,
  BranchUpdateRequest,
  type Organization,
  OrgUpdateRequest,
} from "@app/contracts";
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { OrgRequestContext } from "../../common/context";
import { OrgScoped, RequirePermission } from "../../common/tenant.guard";
import { ZodBody } from "../../common/zod.pipe";
import { branchCreate } from "./use-cases/branch.create";
import { branchList } from "./use-cases/branch.list";
import { branchUpdate } from "./use-cases/branch.update";
import { orgGet } from "./use-cases/org.get";
import { orgUpdate } from "./use-cases/org.update";

interface Request {
  ctx: OrgRequestContext;
}

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
  update(@Req() req: Request, @Body(new ZodBody(OrgUpdateRequest)) body: OrgUpdateRequest): Promise<Organization> {
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
  createBranch(@Req() req: Request, @Body(new ZodBody(BranchCreateRequest)) body: BranchCreateRequest): Promise<Branch> {
    return branchCreate(req.ctx, body);
  }

  @Patch("branches/:branchId")
  @RequirePermission("branch.update")
  updateBranch(
    @Req() req: Request,
    @Param("branchId", new ZodBody(BranchIdParam)) branchId: string,
    @Body(new ZodBody(BranchUpdateRequest)) body: BranchUpdateRequest,
  ): Promise<Branch> {
    return branchUpdate(req.ctx, branchId.toLowerCase(), body);
  }
}
