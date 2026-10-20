import type { EmailMessage, EmailSender } from "./email-sender";

/** Test double: keeps every message in memory so tests can read links out of them. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  /** Simulated provider latency (tests that check the response does not wait for delivery). */
  delayMs = 0;
  /** When set, `send` rejects with it (tests of delivery failures). */
  failWith: Error | null = null;

  async send(message: EmailMessage): Promise<void> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
}
