import { index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../identity/user";
import { organization } from "../org/organization";

// docs/spec/features/foundation.md#tbl-audit_log — append-only (no updated_at; UPDATE/DELETE revoked from app_runtime).
// #contract-audit-list (T-0018-02): keyset pages newest first per org.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().references(() => organization.id),
    actorUserId: uuid().references(() => user.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    userAgent: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_id_occurred_at_id_idx").on(t.orgId, t.occurredAt.desc(), t.id.desc())],
);
