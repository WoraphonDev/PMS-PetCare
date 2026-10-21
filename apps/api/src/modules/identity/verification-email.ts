import type { Tx } from "@app/db";
import { AppError } from "../../common/app-error";
import type { Config } from "../../config";
import type { EmailMessage } from "../notification/email";
import { createEmailVerificationRepository, verificationRecipientEmail } from "./identity.repository";

/** T-0011 supplies this callback to its transaction-bound createAuth; no native token/link is used. */
export async function captureSignupVerification(
  tx: Tx,
  userId: string,
  now: Date,
  config: Config,
  capture: (message: EmailMessage) => void,
): Promise<void> {
  try {
    const token = await createEmailVerificationRepository(config.BETTER_AUTH_SECRET).issueEmailVerification(tx, userId, now);
    if (!token) return;
    // Issuance holds this user's lock until the outer commit; recipient binding cannot change between these reads.
    const to = await verificationRecipientEmail(tx, userId);
    const link = `${config.APP_ORIGIN}/verify-email#token=${encodeURIComponent(token)}`;
    capture({ to, subject: "ยืนยันอีเมล", text: `ยืนยันอีเมลของคุณภายใน 24 ชั่วโมง (ใช้ได้ครั้งเดียว):\n${link}` });
  } catch {
    // Native auth callbacks must never receive SQL parameters or provider/recipient details.
    throw new AppError("INTERNAL");
  }
}
