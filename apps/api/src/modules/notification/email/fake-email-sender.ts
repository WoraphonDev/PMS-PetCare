import type { EmailMessage, EmailSender } from "./email-sender";

/** Test double: keeps every message in memory so tests can read links out of them. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
