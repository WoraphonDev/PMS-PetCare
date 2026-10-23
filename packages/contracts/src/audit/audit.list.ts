import { z } from "zod";
import { strictBody } from "../org/fields";

// docs/spec/features/foundation.md §6 — every audit action, in the spec's order.
export const AUDIT_ACTIONS = [
  "org.updated",
  "branch.created",
  "branch.updated",
  "branch.payment_settings_updated",
  "staff.invited",
  "staff.joined",
  "staff.account_created",
  "staff.password_reset",
  "staff.role_changed",
  "staff.removed",
  "auth.password_reset",
  "auth.two_factor_enabled",
  "auth.two_factor_disabled",
  "platform.org_status_changed",
  "platform.plan_changed",
  "platform.org_viewed",
] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);

/**
 * ISO instant with an offset, kept as sent: Postgres compares it as `timestamptz` (microseconds), so a JS Date
 * (milliseconds) must not round it. `micros` reads it with the same precision for the range checks below, and is null
 * for a calendar-impossible instant (month 13, 30 February, 24:00) that Postgres would refuse.
 */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/;
function micros(instant: string): bigint | null {
  const m = INSTANT.exec(instant);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, fraction = "", zone] = m;
  const [year, month, day] = [Number(y), Number(mo), Number(d)];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || Number(h) > 23 || Number(mi) > 59 || Number(sec) > 59) return null;
  const whole = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}${zone}`);
  if (Number.isNaN(whole)) return null;
  const digits = `${fraction}0000000`.slice(0, 7);
  // Postgres rounds to the nearest microsecond.
  return BigInt(whole) * 1000n + BigInt(digits.slice(0, 6)) + (Number(digits[6]) >= 5 ? 1n : 0n);
}
// One check, so a bad value gets one message: the ISO shape (with an offset) and a real calendar instant.
const Instant = z.string().refine((value) => micros(value) !== null, "Must be an ISO date-time with an offset, e.g. 2031-05-06T07:08:09Z");
const MAX_SPAN_MICROS = 366n * 24n * 60n * 60n * 1_000_000n;

/**
 * #contract-audit-list (T-0018-01 B): ISO instants, `from` inclusive, `to` exclusive. Every filter is optional and may
 * be sent alone; `from < to` and the 366-day span apply when both are sent (T-0018-04 A). The cursor is opaque here.
 */
export const AuditListQuery = strictBody({
  from: Instant.optional(),
  to: Instant.optional(),
  action: AuditAction.optional(),
  actorUserId: z
    .uuid()
    .transform((id) => id.toLowerCase())
    .optional(),
  cursor: z.string().min(1).max(512).optional(),
}).superRefine((value, ctx) => {
  // Only when both bounds are real instants; an invalid one is already reported at its own field.
  const from = value.from === undefined ? null : micros(value.from);
  const to = value.to === undefined ? null : micros(value.to);
  if (from === null || to === null) return;
  const span = to - from;
  if (span <= 0n) ctx.addIssue({ code: "custom", path: ["to"], message: "Must be after from" });
  else if (span > MAX_SPAN_MICROS) ctx.addIssue({ code: "custom", path: ["to"], message: "At most 366 days after from" });
});
export type AuditListQuery = z.infer<typeof AuditListQuery>;

// No ip / userAgent (T-0018-01).
export const AuditEntry = z.strictObject({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid(),
  actor: z.strictObject({ userId: z.uuid(), displayName: z.string() }).nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditListResponse = z.strictObject({ items: z.array(AuditEntry), nextCursor: z.string().nullable() });
export type AuditListResponse = z.infer<typeof AuditListResponse>;
export const AUDIT_PAGE_SIZE = 50;
