import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "../org/branch";
import { organization } from "../org/organization";

// docs/spec/features/foundation.md#tbl-outbox_event · ADR-0004. `id` is the event id used for idempotency.
export const outboxEvent = pgTable(
  "outbox_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid().references(() => organization.id),
    branchId: uuid().references(() => branch.id),
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
  (t) => [index("outbox_event_unpublished_idx").on(t.occurredAt).where(sql`${t.publishedAt} is null`)],
);
