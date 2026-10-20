import type { AuthLoginRequest, AuthLoginResponse } from "@app/contracts";
import type { Db } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { Auth } from "../auth";
import { findUserByIdentifier, isManagedAccountActive } from "../identity.repository";
import type { FailureLimiter } from "../rate-limit";

export interface AuthLoginDeps {
  auth: Auth;
  platformDb: Db;
  limiter: FailureLimiter;
}

export interface AuthLoginResult {
  body: AuthLoginResponse;
  setCookies: string[];
}

const invalid = () => new AppError("UNAUTHENTICATED", "Invalid credentials");

// docs/spec/features/foundation.md#ep-auth.login · F09 · F11
export async function authLogin(
  ctx: { ip: string; headers: Headers },
  input: AuthLoginRequest,
  deps: AuthLoginDeps,
): Promise<AuthLoginResult> {
  const identifier = input.identifier.toLowerCase();
  if (await deps.limiter.isBlocked(identifier, ctx.ip)) throw new AppError("RATE_LIMITED", "Too many failed attempts");

  const fail = async () => {
    await deps.limiter.recordFailure(identifier, ctx.ip);
    return invalid();
  };

  const u = await findUserByIdentifier(deps.platformDb, identifier);
  // Same response whether the account is missing, disabled or the password is wrong.
  if (!u || !(await isManagedAccountActive(deps.platformDb, u))) throw await fail();

  const res = identifier.includes("@")
    ? await deps.auth.api.signInEmail({ body: { email: identifier, password: input.password }, headers: ctx.headers, asResponse: true })
    : await deps.auth.api.signInUsername({
        body: { username: identifier, password: input.password },
        headers: ctx.headers,
        asResponse: true,
      });
  if (!res.ok) throw await fail();

  await deps.limiter.reset(identifier, ctx.ip);
  return {
    body: { twoFactorRequired: false, mustChangePassword: u.mustChangePassword },
    setCookies: res.headers.getSetCookie(),
  };
}
