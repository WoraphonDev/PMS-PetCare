import type { AuthPasswordChangeRequest } from "@app/contracts";
import type { Db } from "@app/db";
import { APIError } from "better-auth/api";
import { AppError } from "../../../common/app-error";
import type { Auth } from "../auth";
import { clearMustChangePassword } from "../identity.repository";

// docs/spec/features/foundation.md#ep-auth.password_change · F09 · F11
export async function authPasswordChange(
  ctx: { headers: Headers; userId: string },
  input: AuthPasswordChangeRequest,
  deps: { auth: Auth; platformDb: Db },
): Promise<void> {
  try {
    // revokeOtherSessions: false — Better Auth's `true` also replaces the current session; we keep it (spec) and
    // revoke only the others below.
    await deps.auth.api.changePassword({
      body: { currentPassword: input.currentPassword, newPassword: input.newPassword, revokeOtherSessions: false },
      headers: ctx.headers,
    });
  } catch (err) {
    if (err instanceof APIError && err.status === "BAD_REQUEST") throw new AppError("UNAUTHENTICATED", "Invalid credentials");
    throw err;
  }
  await deps.auth.api.revokeOtherSessions({ headers: ctx.headers });
  await clearMustChangePassword(deps.platformDb, ctx.userId);
}
