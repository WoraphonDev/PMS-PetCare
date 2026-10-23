import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../common/app-error";

/**
 * #contract-audit-list cursor: opaque `<payload>.<mac>`. The payload is the last row's position (Postgres' own text of
 * `occurred_at`, so microseconds survive, and its id); the HMAC binds it to this org, so a malformed, edited or foreign
 * cursor is VALIDATION_FAILED. The key is derived from the server secret for this one purpose.
 */
export interface Position {
  occurredAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyFor = (secret: string) => createHmac("sha256", secret).update("pms:audit-list-cursor").digest();
const mac = (secret: string, orgId: string, payload: string) =>
  createHmac("sha256", keyFor(secret)).update(`${orgId}.${payload}`).digest("base64url");

export function encodeCursor(secret: string, orgId: string, position: Position): string {
  const payload = Buffer.from(JSON.stringify([position.occurredAt, position.id])).toString("base64url");
  return `${payload}.${mac(secret, orgId, payload)}`;
}

export function decodeCursor(secret: string, orgId: string, cursor: string): Position {
  const invalid = () => new AppError("VALIDATION_FAILED", "Invalid request", { fields: { cursor: ["Invalid cursor"] } });
  const [payload, signature, ...rest] = cursor.split(".");
  if (!payload || !signature || rest.length > 0) throw invalid();
  const expected = Buffer.from(mac(secret, orgId, payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) throw invalid();
  const [occurredAt, id] = decoded as unknown[];
  if (typeof occurredAt !== "string" || Number.isNaN(Date.parse(occurredAt)) || typeof id !== "string" || !UUID.test(id)) throw invalid();
  return { occurredAt, id };
}
