import type { AuthPasswordForgotRequest } from "@app/contracts";
import type { Db } from "@app/db";
import type { Auth } from "../auth";
import { findUserByIdentifier } from "../identity.repository";
import type { FailureLimiter } from "../rate-limit";

// docs/spec/features/foundation.md#ep-auth.password_forgot · F09 · F11 — the caller always answers 204.
export async function authPasswordForgot(
  ctx: { ip: string },
  input: AuthPasswordForgotRequest,
  deps: { auth: Auth; platformDb: Db; limiter: FailureLimiter },
): Promise<void> {
  const email = input.email.toLowerCase();
  if (await deps.limiter.isBlocked(email, ctx.ip)) return;
  await deps.limiter.recordFailure(email, ctx.ip);
  const u = await findUserByIdentifier(deps.platformDb, email);
  // Managed accounts (F09) have no real mailbox and no email recovery.
  if (!u || u.isManaged) return;
  await deps.auth.api.requestPasswordReset({ body: { email } });
}
