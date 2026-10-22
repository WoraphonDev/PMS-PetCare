import { INVITATION_ACCEPT_STATUS, InvitationAcceptRequest, type InvitationAcceptResponse } from "@app/contracts";
import type { Db } from "@app/db";
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { CLOCK, type Clock } from "../../common/context";
import { RUNTIME_DB } from "../../common/db";
import { type AuthedRequest, AuthGuard, type UserRow } from "../identity";
import { OrgBody } from "./org-body.pipe";
import { invitationAccept } from "./use-cases/invitation.accept";

/** #contract-invitation-accept: a logged-in user who is not a member yet — no X-Org-Id, so not @OrgScoped(). */
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
}
