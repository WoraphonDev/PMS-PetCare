import type { AuthLoginRequest, AuthLoginResponse } from "@app/contracts";
import type { Db } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { Auth } from "../auth";
import { findUserByIdentifier, isManagedAccountActive } from "../identity.repository";
import type { FailureLimiter } from "../rate-limit";
import { recordTwoFactorSession } from "../two-factor-session";

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

// docs/spec/features/foundation.md#ep-auth.login · #rule-email-login-policy · F09 · F11
export async function authLogin(
  ctx: { ip: string; headers: Headers; now: Date },
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
  // Deny unverified real-email and disabled managed accounts before Better Auth can create any session/cookie.
  // Only isManaged grants the verification exemption; owning membership (F09) still applies.
  // Hash the presented password so policy failures do password work like wrong-password failures.
  // Unknown identifiers go through Better Auth's sign-in, which already runs a dummy hash for missing accounts.
  if (u && ((!u.isManaged && !u.emailVerified) || !(await isManagedAccountActive(deps.platformDb, u)))) {
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
  const data = (await res.json()) as { twoFactorRedirect?: boolean; user?: { twoFactorEnabled?: boolean } };
  if (data.user?.twoFactorEnabled && !data.twoFactorRedirect) {
    const headers = new Headers(ctx.headers);
    headers.set(
      "cookie",
      res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    );
    const found = await deps.auth.api.getSession({ headers });
    if (!found) throw invalid();
    await recordTwoFactorSession(deps.platformDb, found.session, ctx.now);
  }
  return {
    body: { twoFactorRequired: data.twoFactorRedirect === true, mustChangePassword: u.mustChangePassword },
    setCookies: res.headers.getSetCookie(),
  };
}
