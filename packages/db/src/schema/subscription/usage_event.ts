import { foreignKey, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "../org/branch";
import { organization } from "../org/organization";

// docs/spec/features/foundation.md#tbl-usage_event · ADR-0005 §4 — append-only.
export const usageEvent = pgTable(
  "usage_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organization.id),
    branchId: uuid(),
    kind: text().notNull(),
    quantity: integer().notNull(),
    unitCostSatang: integer(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Q-0014: the branch must belong to the row's organization.
  (t) => [foreignKey({ name: "usage_event_branch_fk", columns: [t.orgId, t.branchId], foreignColumns: [branch.orgId, branch.id] })],
);
