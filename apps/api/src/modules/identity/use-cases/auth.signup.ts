import { randomUUID } from "node:crypto";
import type { AuthSignupRequest, AuthSignupResponse } from "@app/contracts";
import { type Db, withTenantTx } from "@app/db";
import { Logger } from "@nestjs/common";
import { AppError } from "../../../common/app-error";
import type { Config } from "../../../config";
import type { EmailSender } from "../../notification/email";
import { bootstrapOrganization } from "../../org";
import { startFreeSubscription } from "../../subscription";
import { createAuth } from "../auth";
import { emailTaken, isCreatedIdentity, lockSignupEmail } from "../identity.repository";
import type { SignupLimiter } from "../rate-limit";
import { captureVerificationAfterCommit } from "../verification-collector";
import { captureSignupVerification } from "../verification-email";

export interface AuthSignupDeps {
  /** Runtime connection (app_runtime, NOBYPASSRLS) — the whole signup is one transaction on it. */
  db: Db;
  config: Config;
  email: EmailSender;
  limiter: SignupLimiter;
}

// Only these collisions are business conflicts; every other constraint stays INTERNAL.
const CONFLICT_CONSTRAINTS = new Set(["user_email_unique", "organization_slug_unique"]);
const conflict = () => new AppError("CONFLICT", "Email or shop URL already in use");

/** A unique violation of one of `constraints` (also used by auth.signupWithInvitation). */
export function isUniqueViolation(error: unknown, constraints: ReadonlySet<string>): boolean {
  // Drizzle wraps the pg error in `cause`.
  let e = error as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; e && typeof e === "object" && depth < 5; depth++, e = e.cause as typeof e) {
    if (e.code === "23505" && typeof e.constraint === "string" && constraints.has(e.constraint)) return true;
  }
  return false;
}

/**
 * docs/spec/features/foundation.md#ep-auth.signup · #rule-signup-atomic · #rule-signup-abuse
 * Identity, verification state and tenant bootstrap commit together; the email goes out only after commit and
 * the response never carries a session.
 */
export async function authSignup(
  ctx: { now: Date; ip: string },
  input: AuthSignupRequest,
  deps: AuthSignupDeps,
): Promise<AuthSignupResponse> {
  // Schema-valid attempts are counted before any DB work; conflicts are not refunded.
  if (!(await deps.limiter.consume(ctx.ip))) throw new AppError("RATE_LIMITED", "Too many signup attempts");
  const { email } = input;
  const orgId = randomUUID();
  let committed: Awaited<ReturnType<typeof captureVerificationAfterCommit<void>>>;
  try {
    committed = await captureVerificationAfterCommit(
      deps.db,
      deps.email,
      (tx, capture) =>
        // Probes the runtime role before any write and sets app.org_id transaction-locally on this same tx.
        withTenantTx(tx, orgId, async (tenant) => {
          if ((await lockSignupEmail(tx, email)).taken) throw conflict();
          let userId: string;
          try {
            // Savepoint: Better Auth turns a unique violation into a generic error, so recheck after rolling it back.
            userId = await tx.transaction(async (sp) => {
              const auth = createAuth(deps.config, sp, deps.email, (id) =>
                captureSignupVerification(sp, id, ctx.now, deps.config, capture),
              );
              const result = await auth.api.signUpEmail({ body: { email, password: input.password, name: input.displayName } });
              return result.user.id;
            });
          } catch (error) {
            if (await emailTaken(tx, email)) throw conflict();
            throw error;
          }
          if (!(await isCreatedIdentity(tx, userId, email))) throw conflict();
          await bootstrapOrganization(tenant, {
            slug: input.orgSlug,
            displayName: input.orgName,
            branchName: input.branchName,
            ownerUserId: userId,
            ownerDisplayName: input.displayName,
          });
          await startFreeSubscription(tenant, orgId, ctx.now);
        }),
      (category) => new Logger("Email").error(category),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "CONFLICT") throw error;
    if (isUniqueViolation(error, CONFLICT_CONSTRAINTS)) throw conflict();
    // Sanitized: no SQL, constraint detail or address reaches the client or the log.
    throw new AppError("INTERNAL");
  }
  // Delivery failure after commit keeps 201; the collector records only a category.
  await committed.dispatch();
  return { verificationRequired: true };
}
