import type { SubscriptionGetResponse } from "@app/contracts";
import { Controller, Get, Req } from "@nestjs/common";
import type { OrgRequestContext } from "../../common/context";
import { OrgScoped, RequirePermission } from "../../common/tenant.guard";
import { subscriptionGet } from "./use-cases/subscription.get";

@Controller()
@OrgScoped()
export class SubscriptionController {
  @Get("subscription")
  @RequirePermission("subscription.read")
  get(@Req() req: { ctx: OrgRequestContext }): Promise<SubscriptionGetResponse> {
    return subscriptionGet(req.ctx);
  }
}
