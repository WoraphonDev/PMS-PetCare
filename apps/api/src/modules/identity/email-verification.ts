import { createHash, randomUUID } from "node:crypto";
import { type Tx, transactionQuery } from "@app/db";
import { createEmailVerificationToken } from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";
import { AppError } from "../../common/app-error";

const namespace = (id: string) => `pms:email-verify:v1:${id}`;
const digestOf = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () =>
  new AppError("VALIDATION_FAILED", "Invalid verification token", { fields: { token: ["Invalid verification token"] } });
type LockedUser = { id: string; email: string; email_verified: boolean; is_managed: boolean };
const eligible = (user: LockedUser) => !user.email_verified && !user.is_managed && !user.email.endsWith("@managed.invalid");

/** Identity-owned verification state. Every operation must use its caller's outer transaction. */
export function createEmailVerificationRepository(
  secret: string,
  diagnostic: (category: "verification-state-invariant") => void = () => {},
) {
  const invariant = () => {
    diagnostic("verification-state-invariant");
    return new AppError("INTERNAL", "Email verification state invariant");
  };
  return {
    async issueEmailVerification(tx: Tx, userId: string, now: Date): Promise<string | null> {
      const query = transactionQuery(tx);
      const { rows: users } =
        await query<LockedUser>`SELECT id, email, email_verified, is_managed FROM "user" WHERE id = ${userId} FOR UPDATE`;
      const user = users[0];
      if (!user || !eligible(user)) return null;
      // Public pinned Better Auth extension; nonce is inside the authenticated JWT, never separately stored.
      const token = await createEmailVerificationToken(secret, user.email, undefined, 86400, {
        purpose: "email-verify",
        version: 1,
        nonce: randomUUID(),
      });
      const identifier = namespace(user.id);
      await query`DELETE FROM verification WHERE identifier = ${identifier}`;
      await query`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${identifier}, ${JSON.stringify({ purpose: "email-verify", version: 1, digest: digestOf(token) })},
          ${new Date(now.getTime() + 86400000)}, ${now}, ${now})`;
      return token;
    },

    async consumeEmailVerification(tx: Tx, token: string, now: Date): Promise<string> {
      // Pinned public verifier returns null for malformed tokens; it also checks signature and signed expiry.
      // Its internal Date clock is covered by the narrow spec exception.
      const payload = await verifyJWT<Record<string, unknown>>(token, secret);
      if (
        payload?.purpose !== "email-verify" ||
        payload.version !== 1 ||
        typeof payload.email !== "string" ||
        typeof payload.nonce !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.nonce) ||
        "updateTo" in payload ||
        "requestType" in payload
      )
        throw invalid();
      const query = transactionQuery(tx);
      // The signer lowercases email; historical text-unique rows may contain case variants.
      // Reject ambiguity before reading namespace state; never choose an account by digest or rewrite email.
      const { rows: users } =
        await query<LockedUser>`SELECT id, email, email_verified, is_managed FROM "user" WHERE lower(email) = ${payload.email} ORDER BY id FOR UPDATE`;
      const user = users[0];
      if (users.length !== 1 || !user || user.email.toLowerCase() !== payload.email || !eligible(user)) throw invalid();
      const identifier = namespace(user.id);
      const { rows } = await query<{
        id: string;
        value: string;
        live: boolean;
      }>`SELECT id, value, expires_at > ${now} AS live FROM verification WHERE identifier = ${identifier}`;
      if (rows.length > 1) throw invariant();
      const row = rows[0];
      if (!row) throw invalid();
      let state: { purpose?: unknown; version?: unknown; digest?: unknown };
      try {
        state = JSON.parse(row.value);
      } catch {
        throw invariant();
      }
      if (
        state?.purpose !== "email-verify" ||
        state.version !== 1 ||
        typeof state.digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(state.digest)
      )
        throw invariant();
      if (state.digest !== digestOf(token) || !row.live) throw invalid();
      const removed =
        await query`DELETE FROM verification WHERE id = ${row.id} AND identifier = ${identifier} AND value = ${row.value} AND expires_at > ${now}`;
      // Native expired cleanup may remove expired state; it can never make a failed delete succeed.
      if (removed.rowCount !== 1) throw invalid();
      const updated =
        await query`UPDATE "user" SET email_verified = true, updated_at = ${now} WHERE id = ${user.id} AND email = ${user.email} AND email_verified = false AND is_managed = false`;
      if (updated.rowCount !== 1) throw invariant();
      return user.id;
    },
  };
}
