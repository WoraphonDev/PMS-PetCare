import { Module } from "@nestjs/common";
import { CONFIG } from "../../../common/context";
import type { Config } from "../../../config";
import { EMAIL_SENDER, type EmailSender } from "./email-sender";
import { FakeEmailSender } from "./fake-email-sender";
import { SmtpEmailSender } from "./smtp-email-sender";

/** Tests get the in-memory fake; everywhere else SMTP_URL + MAIL_FROM are required (local: Mailpit, see .env.example). */
export function createEmailSender(config: Config): EmailSender {
  if (config.NODE_ENV === "test") return new FakeEmailSender();
  if (!config.SMTP_URL || !config.MAIL_FROM) throw new Error("Invalid environment: MAIL_FROM, SMTP_URL");
  return new SmtpEmailSender(config.SMTP_URL, config.MAIL_FROM);
}

@Module({
  providers: [{ provide: EMAIL_SENDER, inject: [CONFIG], useFactory: createEmailSender }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
