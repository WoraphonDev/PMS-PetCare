import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "../org/branch";
import { organization } from "../org/organization";

// docs/spec/features/foundation.md#tbl-outbox_event · ADR-0004. `id` is the event id used for idempotency.
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().references(() => organization.id),
    branchId: uuid(),
    type: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: uuid().notNull(),
    aggregateVersion: integer().notNull(),
    payload: jsonb().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Worker reads pending events in time order: `where published_at is null order by occurred_at` (Q-0013).
  (t) => [
    index("outbox_event_unpublished_idx").on(t.occurredAt).where(sql`${t.publishedAt} is null`),
    // Q-0014: the branch must belong to the event's organization. MATCH SIMPLE skips the FK when org_id is null,
    // so a branch without an organization is rejected by the CHECK.
    foreignKey({ name: "outbox_event_branch_fk", columns: [t.orgId, t.branchId], foreignColumns: [branch.orgId, branch.id] }),
    check("outbox_event_branch_needs_org", sql`${t.branchId} is null or ${t.orgId} is not null`),
  ],
);
