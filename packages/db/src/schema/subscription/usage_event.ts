import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "../org/branch";
import { organization } from "../org/organization";

// docs/spec/features/foundation.md#tbl-usage_event · ADR-0005 §4 — append-only.
export const usageEvent = pgTable("usage_event", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: uuid()
    .notNull()
    .references(() => organization.id),
  branchId: uuid().references(() => branch.id),
  kind: text().notNull(),
  quantity: integer().notNull(),
  unitCostSatang: integer(),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
