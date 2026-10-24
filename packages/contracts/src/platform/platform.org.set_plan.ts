import { z } from "zod";
import { strictBody, Text } from "../org/fields";

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):?(\d{2}))$/;

/** An ISO instant with an offset that Postgres accepts as `timestamptz` (no 31 February, 24:00, year 0000, ±16:00). */
function isInstant(value: string): boolean {
  const m = INSTANT.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second, offsetHours, offsetMinutes] = m.slice(1).map((part) => Number(part ?? 0));
  if (year === undefined || month === undefined || day === undefined) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
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
const Instant = z.string().refine(isInstant, "Must be an ISO date-time with an offset, e.g. 2031-05-06T07:08:09Z");

/**
 * docs/spec/features/foundation.md#contract-platform-set-plan (T-0020-01 A): PUT replaces — an omitted
 * `currentPeriodEnd` or `note` is null. Whether `planCode` names an active plan is checked by the server.
 */
export const PlatformOrgSetPlanRequest = strictBody({
  planCode: Text(50),
  currentPeriodEnd: Instant.nullable().optional(),
  note: Text(500).nullable().optional(),
}).transform((body) => ({ planCode: body.planCode, currentPeriodEnd: body.currentPeriodEnd ?? null, note: body.note ?? null }));
export type PlatformOrgSetPlanRequest = z.infer<typeof PlatformOrgSetPlanRequest>;
