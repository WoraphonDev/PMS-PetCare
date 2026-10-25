import type { AuthSignupWithInvitationRequest, AuthSignupWithInvitationResponse } from "@app/contracts";
import { type Db, withTenant } from "@app/db";
import { AppError } from "../../../common/app-error";
import { claimInvitation, invitationTokenOrg, writeInvitationAccept } from "../../org";
import type { Auth } from "../auth";
import { emailTaken } from "../identity.repository";
import { createInvitedUser, hashPassword } from "../managed-account";
import type { SignupLimiter } from "../rate-limit";
import { isUniqueViolation } from "./auth.signup";

export interface AuthSignupWithInvitationDeps {
  /** Runtime connection (app_runtime, NOBYPASSRLS) — the whole signup is one tenant transaction on it. */
  runtimeDb: Db;
  auth: Auth;
  limiter: SignupLimiter;
}

const EMAIL_UNIQUE = new Set(["user_email_unique"]);
const conflict = () => new AppError("CONFLICT", "Email already in use");

/**
 * docs/spec/features/foundation.md#contract-signup-with-invitation · #rule-signup-invite-email-race
 * The user and the accept write commit together in the invitation's tenant transaction; no session, no email.
 */
export async function authSignupWithInvitation(
  ctx: { now: Date; ip: string },
  input: AuthSignupWithInvitationRequest,
  deps: AuthSignupWithInvitationDeps,
): Promise<AuthSignupWithInvitationResponse> {
  // Schema-valid attempts are counted before any DB work; invitation errors and conflicts are not refunded.
  if (!(await deps.limiter.consume(ctx.ip))) throw new AppError("RATE_LIMITED", "Too many signup attempts");
  const orgId = invitationTokenOrg(input.token); // 1
  if (!orgId) throw new AppError("INVITATION_INVALID");
  // Slow on purpose: hash before taking any lock.
  const passwordHash = await hashPassword(deps.auth, input.password);
  try {
    return await withTenant(deps.runtimeDb, orgId, async (tx) => {
      const invitation = await claimInvitation(tx, orgId, input.token, ctx.now); // 2 — no email comparison
      const email = invitation.email.toLowerCase();
      // 3 — a pre-check only: across invitations or against auth.signup, user_email_unique decides (caught below).
      if (await emailTaken(tx, email)) throw conflict();
      const userId = await createInvitedUser(tx, { email, name: input.displayName, passwordHash, now: ctx.now }); // 4
      await writeInvitationAccept(tx, { orgId, invitation, userId, displayName: input.displayName }, ctx.now); // 5
      return { orgId, role: invitation.role };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    // The losing side of an email race rolled back everything; it is a conflict, never INTERNAL.
    if (isUniqueViolation(error, EMAIL_UNIQUE)) throw conflict();
    // Sanitized: no SQL, constraint detail or address reaches the client or the log.
    throw new AppError("INTERNAL");
  }
}
