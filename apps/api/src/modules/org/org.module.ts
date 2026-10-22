import { Module } from "@nestjs/common";
import { BackgroundWork } from "../identity";
import { EmailModule } from "../notification/email";
import { INVITATION_MAIL_BACKGROUND } from "./invitation-email";
import { OrgController } from "./org.controller";
import { StaffController } from "./staff.controller";

@Module({
  imports: [EmailModule],
  controllers: [OrgController, StaffController],
  providers: [{ provide: INVITATION_MAIL_BACKGROUND, useValue: new BackgroundWork() }],
})
export class OrgModule {}
