import { inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization } from "../org/organization";

// docs/spec/features/foundation.md#tbl-audit_log — append-only (no updated_at; UPDATE/DELETE revoked from app_runtime).
// actor_user_id gets its FK to "user" when the identity tables arrive.
export const auditLog = pgTable("audit_log", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: uuid().references(() => organization.id),
  actorUserId: uuid(),
  action: text().notNull(),
  entityType: text().notNull(),
  entityId: uuid().notNull(),
  before: jsonb(),
  after: jsonb(),
  ip: inet(),
  userAgent: text(),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
