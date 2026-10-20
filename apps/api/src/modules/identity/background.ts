import { Logger } from "@nestjs/common";

/**
 * Work that must not delay the response (e.g. sending the reset email, so response time does not reveal whether
 * an account exists). `idle()` lets tests wait for it. Failures log a fixed text plus an allowlisted error code only:
 * provider messages can carry the recipient address or a link (AGENTS.md rule 9).
 */
export class BackgroundWork {
  private readonly pending = new Set<Promise<void>>();
  private readonly logger = new Logger("BackgroundWork");

  run(label: string, work: () => Promise<unknown>): void {
    const p: Promise<void> = work()
      .then(() => undefined)
      .catch((err: unknown) => this.logger.error(`${label} failed (${errorCode(err)})`))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all(this.pending);
  }
}

/** e.g. nodemailer `EENVELOPE`, `ECONNECTION` — codes are constants, never user data. */
export function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : "unknown";
}

export const BACKGROUND = Symbol("BACKGROUND");
