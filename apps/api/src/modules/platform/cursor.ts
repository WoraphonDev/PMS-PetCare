import { AppError } from "../../common/app-error";
import type { OrgPosition } from "../org";

/**
 * #contract-platform-org-read cursor: opaque base64url of the last row's position (Postgres' text of `created_at`, so
 * microseconds survive, and its id). Every shop is visible to a platform admin, so it is not signed; anything that does
 * not decode to a position is VALIDATION_FAILED.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

export function encodeCursor(position: OrgPosition): string {
  return Buffer.from(JSON.stringify([position.createdAt, position.id])).toString("base64url");
}

export function decodeCursor(cursor: string): OrgPosition {
  const invalid = () => new AppError("VALIDATION_FAILED", "Invalid request", { fields: { cursor: ["Invalid cursor"] } });
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) throw invalid();
  const [createdAt, id] = decoded as unknown[];
  // Date.parse needs an ISO offset ("+00" → "+00:00"); it rejects impossible calendar values Postgres would refuse.
  const iso = typeof createdAt === "string" ? createdAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") : "";
  if (typeof createdAt !== "string" || !PG_TIMESTAMPTZ.test(createdAt) || Number.isNaN(Date.parse(iso))) throw invalid();
  if (typeof id !== "string" || !UUID.test(id)) throw invalid();
  return { createdAt, id };
}
