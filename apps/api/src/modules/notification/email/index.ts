// Public API of notification/email (ADR-0002): other modules import only from here.
export { EmailModule } from "./email.module";
export { EMAIL_SENDER, type EmailMessage, type EmailSender } from "./email-sender";
export { FakeEmailSender } from "./fake-email-sender";
