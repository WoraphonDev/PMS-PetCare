import type { AuthPasswordResetRequest } from "@app/contracts";
import type { Db } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { Auth } from "../auth";
import { resetPasswordWithToken } from "../identity.repository";

// docs/spec/features/foundation.md#ep-auth.password_reset · F11 · audit `auth.password_reset`
export async function authPasswordReset(
  ctx: { now: Date; ip: string; userAgent: string | null },
  input: AuthPasswordResetRequest,
  deps: { auth: Auth; platformDb: Db },
): Promise<void> {
  // Hash first (same cost for every token), then token + password + sessions + audit change atomically.
  const passwordHash = await (await deps.auth.$context).password.hash(input.password);
  const userId = await resetPasswordWithToken(deps.platformDb, { token: input.token, passwordHash, ...ctx });
  if (!userId) throw new AppError("VALIDATION_FAILED", "Invalid request", { fields: { token: ["Invalid, expired or already used"] } });
}
