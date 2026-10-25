import type Valkey from "iovalkey";
import { AppError } from "../../common/app-error";

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
    // One MULTI: the key is created with its TTL before the first increment, so a counter can never outlive the window.
    await this.valkey.multi().set(key, 0, "EX", this.windowSeconds, "NX").incr(key).exec();
  }

  /**
   * Counts one attempt and says whether it is still within the limit — check and increment in one MULTI, so
   * concurrent requests cannot all pass a separate check (password-forgot counts every request, not only failures).
   */
  async tryConsume(...parts: string[]): Promise<boolean> {
    const key = this.key(parts);
    const res = await this.valkey.multi().set(key, 0, "EX", this.windowSeconds, "NX").incr(key).exec();
    return Number(res?.[1]?.[1]) <= this.limit;
  }

  /** Seconds until the counter resets (-2 = no counter). For tests and diagnostics. */
  ttl(...parts: string[]): Promise<number> {
    return this.valkey.ttl(this.key(parts));
  }

  async reset(...parts: string[]): Promise<void> {
    await this.valkey.del(this.key(parts));
  }
}

export const LOGIN_LIMITER = Symbol("LOGIN_LIMITER");
/** F11: 5 failed logins / 15 minutes / (identifier + IP). */
export const loginLimiter = (valkey: Valkey) => new FailureLimiter(valkey, "login-fail", 5, 15 * 60);

export const FORGOT_LIMITER = Symbol("FORGOT_LIMITER");
/** F11: 3 password-forgot requests / hour / (email + IP) — every request counts, not only failures. */
export const forgotLimiter = (valkey: Valkey) => new FailureLimiter(valkey, "pw-forgot", 3, 60 * 60);

/** Pure ports: callers validate schema before consuming, and consume before lookup/write/send.
 * Conflicts, unknown/verified/managed recipients and delivery failures never refund attempts.
 */
export interface SignupLimiter {
  /** false = RATE_LIMITED; infrastructure failure throws sanitized INTERNAL. */
  consume(ip: string): Promise<boolean>;
}
export interface ResendLimiter {
  /** false = suppress rotation/send, including infrastructure failure. */
  consume(email: string, ip: string): Promise<boolean>;
}

// Standalone Valkey only. Dual-key EVAL is not a cluster/key-slot topology guarantee;
// CROSSSLOT and all other command failures fail closed. No deployment topology is inferred.
// Validate every existing counter before mutating either key: Lua runtime errors do not roll back writes.
const CONSUME_ATTEMPT = `
for i, key in ipairs(KEYS) do
  local value = redis.call('GET', key)
  if value then
    local count = tonumber(value)
    if not count or count < 1 or count % 1 ~= 0 or count >= 9007199254740991
      or not string.match(value, '^[1-9]%d*$') or redis.call('PTTL', key) <= 0 then
      return redis.error_reply('Invalid abuse counter')
    end
  end
end
local allowed = 1
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
  if count > tonumber(ARGV[i + 1]) then allowed = 0 end
end
return allowed
`;

const attemptKey = (prefix: string, part: string) => `${prefix}:${encodeURIComponent(part.toLowerCase())}`;

async function consumeAttempt(valkey: Valkey, keys: string[], limits: number[]): Promise<boolean> {
  const result = await valkey.eval(CONSUME_ATTEMPT, keys.length, ...keys, 3600, ...limits);
  if (result !== 0 && result !== 1) throw new Error("Invalid abuse counter response");
  return result === 1;
}

export const SIGNUP_LIMITER = Symbol("SIGNUP_LIMITER");
export const SIGNUP_INVITE_LIMITER = Symbol("SIGNUP_INVITE_LIMITER");
export const RESEND_LIMITER = Symbol("RESEND_LIMITER");

/** 5 schema-valid attempts / hour / trusted IP under `prefix`; Valkey failure fails closed (INTERNAL). */
const ipLimiter =
  (prefix: string) =>
  (valkey: Valkey): SignupLimiter => ({
    async consume(ip) {
      try {
        return await consumeAttempt(valkey, [attemptKey(prefix, ip)], [5]);
      } catch {
        throw new AppError("INTERNAL");
      }
    },
  });

export const signupLimiter = ipLimiter("signup-attempt");
/** #contract-signup-with-invitation: same numbers as signup, its own counter. */
export const signupInviteLimiter = ipLimiter("signup-invite");

export const resendLimiter = (valkey: Valkey): ResendLimiter => ({
  async consume(email, ip) {
    try {
      return await consumeAttempt(valkey, [attemptKey("resend-email-attempt", email), attemptKey("resend-ip-attempt", ip)], [3, 10]);
    } catch {
      return false;
    }
  },
});
