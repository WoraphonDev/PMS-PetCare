import type { Db, Tx } from "@app/db";
import type { EmailMessage, EmailSender } from "../notification/email";

/** Request-local capture. Only the resolved outer transaction exposes dispatch; rejection discards everything. */
export async function captureVerificationAfterCommit<T>(
  db: Db,
  sender: EmailSender,
  work: (tx: Tx, capture: (message: EmailMessage) => void) => Promise<T>,
  diagnostic: (category: "verification-email-send-failed") => void = () => {},
): Promise<{ value: T; dispatch(): Promise<void> }> {
  let messages: EmailMessage[] = [];
  let open = true;
  let value: T;
  try {
    value = await db.transaction(async (tx) => {
      try {
        return await work(tx, (message) => {
          if (!open) throw new Error("Verification capture closed");
          messages.push({ ...message });
        });
      } finally {
        open = false;
      }
    });
  } catch (error) {
    messages = [];
    throw error;
  }
  let delivery: Promise<void> | undefined;
  return {
    value,
    dispatch() {
      delivery ??= (async () => {
        const captured = messages;
        messages = [];
        for (const message of captured) {
          try {
            await sender.send(message);
          } catch {
            diagnostic("verification-email-send-failed");
          }
        }
      })();
      return delivery;
    },
  };
}
