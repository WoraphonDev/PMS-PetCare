import { createHash, randomBytes } from "node:crypto";

// docs/spec/features/foundation.md#rule-invitation-token — `<orgId>.<32 random bytes base64url>`; only the SHA-256 of
// the whole token is stored. The token itself is emailed once and never stored, returned, audited or logged.

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInvitationToken(orgId: string): { token: string; hash: string } {
  const token = `${orgId}.${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashInvitationToken(token) };
}

const TOKEN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;

/** The organization id of a well-formed token; null for anything else (→ INVITATION_INVALID). */
export function invitationTokenOrg(token: string): string | null {
  return TOKEN.exec(token)?.[1] ?? null;
}
