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
  // A disabled managed account (F09) must cost the same as a wrong password, so timing does not reveal it:
  // hash the presented password, then fail. Unknown identifiers go through Better Auth's sign-in, which already
  // runs a dummy hash for missing accounts.
  if (u && !(await isManagedAccountActive(deps.platformDb, u))) {
    await (await deps.auth.$context).password.hash(input.password);
    throw await fail();
  }

  const res = identifier.includes("@")
    ? await deps.auth.api.signInEmail({ body: { email: identifier, password: input.password }, headers: ctx.headers, asResponse: true })
    : await deps.auth.api.signInUsername({
        body: { username: identifier, password: input.password },
        headers: ctx.headers,
        asResponse: true,
      });
  if (!res.ok) throw await fail();

  if (!u) throw await fail(); // unreachable in practice: sign-in succeeded, so the user exists
  await deps.limiter.reset(identifier, ctx.ip);
  return {
    body: { twoFactorRequired: false, mustChangePassword: u.mustChangePassword },
    setCookies: res.headers.getSetCookie(),
  };
}
