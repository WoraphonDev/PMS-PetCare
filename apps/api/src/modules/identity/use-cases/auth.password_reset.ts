import type { AuthPasswordResetRequest } from "@app/contracts";
import { type Db, withPlatform, writeAudit } from "@app/db";
import { APIError } from "better-auth/api";
import { AppError } from "../../../common/app-error";
import type { Auth } from "../auth";

const invalidToken = () =>
  new AppError("VALIDATION_FAILED", "Invalid request", { fields: { token: ["Invalid, expired or already used"] } });

// docs/spec/features/foundation.md#ep-auth.password_reset · F11 · audit `auth.password_reset`
export async function authPasswordReset(
  ctx: { now: Date; ip: string; userAgent: string | null },
  input: AuthPasswordResetRequest,
  deps: { auth: Auth; platformDb: Db },
): Promise<void> {
  const internal = (await deps.auth.$context).internalAdapter;
  const userId = (await internal.findVerificationValue(`reset-password:${input.token}`))?.value;
  if (!userId) throw invalidToken();
  try {
    // Checks expiry and consumes the token (single use) in the same step as the password update.
    await deps.auth.api.resetPassword({ body: { token: input.token, newPassword: input.password } });
  } catch (err) {
    if (err instanceof APIError && err.status === "BAD_REQUEST") throw invalidToken();
    throw err;
  }
  await internal.deleteUserSessions(userId); // every session, including any on this device
  await withPlatform(deps.platformDb, (tx) =>
    writeAudit(tx, {
      orgId: null,
      actorUserId: userId,
      action: "auth.password_reset",
      entityType: "user",
      entityId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      occurredAt: ctx.now,
    }),
  );
}
