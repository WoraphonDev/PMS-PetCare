import type { Clock } from "@app/domain";
import { Controller, Get, Inject, Req } from "@nestjs/common";
import { CLOCK, CONFIG } from "../../common/context";
import type { Config } from "../../config";
import { systemHealth } from "./use-cases/system.health";

@Controller()
export class SystemController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("health")
  health(@Req() req: { id: string }) {
    return systemHealth({ requestId: req.id, now: this.clock.now(), buildSha: this.config.BUILD_SHA });
  }
}
