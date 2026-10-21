import type { AuthEmailVerifyRequest } from "@app/contracts";
import type { Db } from "@app/db";
import { Logger } from "@nestjs/common";
import { AppError } from "../../../common/app-error";
import { createEmailVerificationRepository } from "../identity.repository";

export async function authEmailVerify(ctx: { now: Date }, input: AuthEmailVerifyRequest, deps: { db: Db; secret: string }): Promise<void> {
  try {
    const repository = createEmailVerificationRepository(deps.secret, (category) => new Logger("Identity").error(category));
    await deps.db.transaction((tx) => repository.consumeEmailVerification(tx, input.token, ctx.now));
  } catch (error) {
    // SQL exceptions can contain parameters: never forward them to the HTTP logger or recast them as invalid tokens.
    if (error instanceof AppError) throw error;
    throw new AppError("INTERNAL");
  }
}
