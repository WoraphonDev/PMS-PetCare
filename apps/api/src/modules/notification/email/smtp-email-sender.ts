import { createTransport, type Transporter } from "nodemailer";
import type { EmailMessage, EmailSender } from "./email-sender";

/** SMTP provider (ADR-0005 §5: SMTP / free tier now, SES later). Local development uses Mailpit (docker-compose). */
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
