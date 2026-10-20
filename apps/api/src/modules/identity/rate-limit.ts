import type Valkey from "iovalkey";

/**
 * Failure counter in Valkey (F11). Keys expire on their own; `limit` failures inside `windowSeconds` block further
 * attempts until the window ends. Reused by password-forgot (T-0008) with its own prefix/limit.
 */
export class FailureLimiter {
  constructor(
    private readonly valkey: Valkey,
    private readonly prefix: string,
    private readonly limit: number,
    private readonly windowSeconds: number,
  ) {}

  private key(parts: string[]) {
    return `${this.prefix}:${parts.map((p) => encodeURIComponent(p.toLowerCase())).join(":")}`;
  }

  async isBlocked(...parts: string[]): Promise<boolean> {
    const count = Number((await this.valkey.get(this.key(parts))) ?? 0);
    return count >= this.limit;
  }

  async recordFailure(...parts: string[]): Promise<void> {
    const key = this.key(parts);
    const count = await this.valkey.incr(key);
    if (count === 1) await this.valkey.expire(key, this.windowSeconds);
  }

  async reset(...parts: string[]): Promise<void> {
    await this.valkey.del(this.key(parts));
  }
}

export const LOGIN_LIMITER = Symbol("LOGIN_LIMITER");
/** F11: 5 failed logins / 15 minutes / (identifier + IP). */
export const loginLimiter = (valkey: Valkey) => new FailureLimiter(valkey, "login-fail", 5, 15 * 60);
