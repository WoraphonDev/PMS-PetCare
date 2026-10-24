import { AppError } from "../../common/app-error";
import type { OrgPosition } from "../org";

/**
 * #contract-platform-org-read cursor: opaque base64url of the last row's position (Postgres' text of `created_at`, so
 * microseconds survive, and its id). Every shop is visible to a platform admin, so it is not signed; anything that does
 * not decode to a position is VALIDATION_FAILED.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PG_TIMESTAMPTZ = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?$/;

/** Postgres' `timestamptz` text, checked part by part: Date.parse would roll 31 February over into March. */
function isInstant(text: string): boolean {
  const m = PG_TIMESTAMPTZ.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second, offsetHours, offsetMinutes] = m.slice(1).map((part) => Number(part ?? 0));
  if (year === undefined || month === undefined || day === undefined) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  // Postgres refuses year 0000 and offsets beyond ±15:59.
  return (
    year >= 1 &&
    day >= 1 &&
    day <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    Number(offsetHours) <= 15 &&
    Number(offsetMinutes) <= 59
  );
}

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
  if (typeof createdAt !== "string" || !isInstant(createdAt)) throw invalid();
  if (typeof id !== "string" || !UUID.test(id)) throw invalid();
  return { createdAt, id };
}
