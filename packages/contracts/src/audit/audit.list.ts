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

const Instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

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
  if (!value.from || !value.to) return;
  if (value.from >= value.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Must be after from" });
  else if (value.to.getTime() - value.from.getTime() > MAX_SPAN_MS)
    ctx.addIssue({ code: "custom", path: ["to"], message: "At most 366 days after from" });
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
