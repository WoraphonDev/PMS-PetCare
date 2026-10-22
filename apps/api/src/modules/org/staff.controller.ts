import {
  type Invitation,
  ScheduleQuery,
  STAFF_ACCOUNT_CREATE_STATUS,
  STAFF_INVITATION_REVOKE_STATUS,
  STAFF_INVITE_STATUS,
  STAFF_PASSWORD_RESET_STATUS,
  StaffAccountCreateRequest,
  StaffInvitationParams,
  StaffInviteRequest,
  type StaffListResponse,
  type StaffMember,
  StaffMembershipParams,
  StaffPasswordResetRequest,
} from "@app/contracts";
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { CONFIG, type OrgRequestContext } from "../../common/context";
import { OrgScoped, RequirePermission } from "../../common/tenant.guard";
import type { Config } from "../../config";
import { AUTH, type Auth, type BackgroundWork } from "../identity";
import { EMAIL_SENDER, type EmailSender } from "../notification/email";
import { INVITATION_MAIL_BACKGROUND } from "./invitation-email";
import { assertNoBody, type NoBodyRequest, OrgBody } from "./org-body.pipe";
import { staffAccountCreate } from "./use-cases/staff.account.create";
import { staffInvitationRevoke } from "./use-cases/staff.invitation.revoke";
import { staffInvite } from "./use-cases/staff.invite";
import { staffList } from "./use-cases/staff.list";
import { staffPasswordReset } from "./use-cases/staff.password.reset";

interface Request extends NoBodyRequest {
  ctx: OrgRequestContext;
}

@Controller()
@OrgScoped()
export class StaffController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(INVITATION_MAIL_BACKGROUND) private readonly background: BackgroundWork,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Get("staff")
  @RequirePermission("staff.read")
  list(@Req() req: Request): Promise<StaffListResponse> {
    return staffList(req.ctx);
  }

  @Post("staff/invitations")
  @HttpCode(STAFF_INVITE_STATUS)
  @RequirePermission("staff.invite")
  invite(@Req() req: Request, @Body(new OrgBody(StaffInviteRequest)) body: StaffInviteRequest): Promise<Invitation> {
    return staffInvite(req.ctx, body, { sender: this.sender, background: this.background, appOrigin: this.config.APP_ORIGIN });
  }

  // DELETE body/query rules of #contract-branch-schedule-common (#contract-staff-invitation-revoke).
  @Delete("staff/invitations/:invitationId")
  @HttpCode(STAFF_INVITATION_REVOKE_STATUS)
  @RequirePermission("staff.invite")
  async revoke(
    @Req() req: Request,
    @Param(new OrgBody(StaffInvitationParams)) params: StaffInvitationParams,
    @Query(new OrgBody(ScheduleQuery)) _query: unknown,
  ): Promise<void> {
    await assertNoBody(req);
    return staffInvitationRevoke(req.ctx, params.invitationId.toLowerCase());
  }

  @Post("staff/accounts")
  @HttpCode(STAFF_ACCOUNT_CREATE_STATUS)
  @RequirePermission("staff.invite")
  createAccount(@Req() req: Request, @Body(new OrgBody(StaffAccountCreateRequest)) body: StaffAccountCreateRequest): Promise<StaffMember> {
    return staffAccountCreate(req.ctx, body, this.auth);
  }

  @Put("staff/:membershipId/password")
  @HttpCode(STAFF_PASSWORD_RESET_STATUS)
  @RequirePermission("staff.update")
  resetPassword(
    @Req() req: Request,
    @Param(new OrgBody(StaffMembershipParams)) params: StaffMembershipParams,
    @Body(new OrgBody(StaffPasswordResetRequest)) body: StaffPasswordResetRequest,
  ): Promise<void> {
    return staffPasswordReset(req.ctx, params.membershipId.toLowerCase(), body, this.auth);
  }
}
