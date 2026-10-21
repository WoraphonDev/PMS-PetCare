import type { AuthEmailVerificationResendRequest } from "@app/contracts";
import type { Db } from "@app/db";
import { Logger } from "@nestjs/common";
import { AppError } from "../../../common/app-error";
import type { Config } from "../../../config";
import type { EmailSender } from "../../notification/email";
import { findVerificationRecipient } from "../identity.repository";
import type { ResendLimiter } from "../rate-limit";
import { captureVerificationAfterCommit } from "../verification-collector";
import { captureSignupVerification } from "../verification-email";

export async function authEmailVerificationResend(
  ctx: { now: Date; ip: string },
  input: AuthEmailVerificationResendRequest,
  deps: { db: Db; config: Config; email: EmailSender; limiter: ResendLimiter },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  // Both counters are consumed atomically before any recipient branch or database operation.
  if (!(await deps.limiter.consume(email, ctx.ip))) return;
  try {
    const committed = await captureVerificationAfterCommit(
      deps.db,
      deps.email,
      async (tx, capture) => {
        const recipient = await findVerificationRecipient(tx, email);
        if (recipient) await captureSignupVerification(tx, recipient, ctx.now, deps.config, capture);
      },
      (category) => new Logger("Email").error(category),
    );
    await committed.dispatch();
  } catch {
    throw new AppError("INTERNAL");
  }
}
