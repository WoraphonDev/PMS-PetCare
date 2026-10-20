import type { AuthPasswordChangeRequest } from "@app/contracts";
import type { Db } from "@app/db";
import { AppError } from "../../../common/app-error";
import type { Auth } from "../auth";
import { changePasswordKeepingSession, credentialHashOf } from "../identity.repository";

const invalid = () => new AppError("UNAUTHENTICATED", "Invalid credentials");

// docs/spec/features/foundation.md#ep-auth.password_change · F09 · F11
export async function authPasswordChange(
  ctx: { now: Date; userId: string; sessionId: string },
  input: AuthPasswordChangeRequest,
  deps: { auth: Auth; platformDb: Db },
): Promise<void> {
  const { password } = await deps.auth.$context;
  const hash = await credentialHashOf(deps.platformDb, ctx.userId);
  if (!hash || !(await password.verify({ hash, password: input.currentPassword }))) throw invalid();
  const passwordHash = await password.hash(input.newPassword);
  if (!(await changePasswordKeepingSession(deps.platformDb, { ...ctx, passwordHash }))) throw invalid();
}
