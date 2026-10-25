import {
  INVITATION_ACCEPT_STATUS,
  INVITATION_PREVIEW_STATUS,
  InvitationAcceptRequest,
  type InvitationAcceptResponse,
  InvitationPreviewRequest,
  type InvitationPreviewResponse,
} from "@app/contracts";
import type { Db } from "@app/db";
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { CLOCK, type Clock } from "../../common/context";
import { RUNTIME_DB } from "../../common/db";
import { type AuthedRequest, AuthGuard, type UserRow } from "../identity";
import { OrgBody } from "./org-body.pipe";
import { invitationAccept } from "./use-cases/invitation.accept";
import { invitationPreview } from "./use-cases/invitation.preview";

/**
 * #contract-invitation-accept: a logged-in user who is not a member yet — no X-Org-Id, so not @OrgScoped().
 * #contract-invitation-preview: public, no session.
 */
@Controller()
export class InvitationController {
  constructor(
    @Inject(RUNTIME_DB) private readonly runtimeDb: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post("invitations/accept")
  @HttpCode(INVITATION_ACCEPT_STATUS)
  @UseGuards(AuthGuard)
  accept(
    @Req() req: AuthedRequest,
    @Body(new OrgBody(InvitationAcceptRequest)) body: InvitationAcceptRequest,
  ): Promise<InvitationAcceptResponse> {
    return invitationAccept(req.user as UserRow, body, { runtimeDb: this.runtimeDb, now: this.clock.now() });
  }

  @Post("invitations/preview")
  @HttpCode(INVITATION_PREVIEW_STATUS)
  preview(@Body(new OrgBody(InvitationPreviewRequest)) body: InvitationPreviewRequest): Promise<InvitationPreviewResponse> {
    return invitationPreview(body, { runtimeDb: this.runtimeDb, now: this.clock.now() });
  }
}
