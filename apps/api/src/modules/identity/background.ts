import { Logger } from "@nestjs/common";

/**
 * Work that must not delay the response (e.g. sending the reset email, so response time does not reveal whether
 * an account exists). Failures are logged by message only — never the payload. `idle()` lets tests wait for it.
 */
export class BackgroundWork {
  private readonly pending = new Set<Promise<void>>();
  private readonly logger = new Logger("BackgroundWork");

  run(label: string, work: () => Promise<unknown>): void {
    const p: Promise<void> = work()
      .then(() => undefined)
      .catch((err: unknown) => this.logger.error(`${label} failed: ${err instanceof Error ? err.message : "unknown error"}`))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all(this.pending);
  }
}

export const BACKGROUND = Symbol("BACKGROUND");
