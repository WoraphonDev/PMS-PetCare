import {
  type Invitation,
  ScheduleQuery,
  STAFF_INVITATION_REVOKE_STATUS,
  STAFF_INVITE_STATUS,
  StaffInvitationParams,
  StaffInviteRequest,
  type StaffListResponse,
} from "@app/contracts";
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { CONFIG, type OrgRequestContext } from "../../common/context";
import { OrgScoped, RequirePermission } from "../../common/tenant.guard";
import type { Config } from "../../config";
import type { BackgroundWork } from "../identity";
import { EMAIL_SENDER, type EmailSender } from "../notification/email";
import { INVITATION_MAIL_BACKGROUND } from "./invitation-email";
import { assertNoBody, type NoBodyRequest, OrgBody } from "./org-body.pipe";
import { staffInvitationRevoke } from "./use-cases/staff.invitation.revoke";
import { staffInvite } from "./use-cases/staff.invite";
import { staffList } from "./use-cases/staff.list";

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
}
