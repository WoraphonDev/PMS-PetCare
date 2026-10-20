import type { AuthPasswordForgotRequest } from "@app/contracts";
import type { Db } from "@app/db";
import type { Auth } from "../auth";
import type { BackgroundWork } from "../background";
import { findUserByIdentifier } from "../identity.repository";
import type { FailureLimiter } from "../rate-limit";

// docs/spec/features/foundation.md#ep-auth.password_forgot · F09 · F11 — the caller always answers 204.
// Everything account-dependent (lookup, token, email) runs in the background, so every request costs the same.
export async function authPasswordForgot(
  ctx: { ip: string },
  input: AuthPasswordForgotRequest,
  deps: { auth: Auth; platformDb: Db; limiter: FailureLimiter; background: BackgroundWork },
): Promise<void> {
  const email = input.email.toLowerCase();
  if (!(await deps.limiter.tryConsume(email, ctx.ip))) return;
  deps.background.run("password reset email", async () => {
    const u = await findUserByIdentifier(deps.platformDb, email);
    // Managed accounts (F09) have no real mailbox and no email recovery.
    if (!u || u.isManaged) return;
    await deps.auth.api.requestPasswordReset({ body: { email } });
  });
}
