import { sql } from "drizzle-orm";
import { check, date, foreignKey, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { organization } from "./organization";

// docs/spec/features/foundation.md#tbl-branch_closure — local dates as YYYY-MM-DD strings.
export const branchClosure = pgTable(
  "branch_closure",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organization.id),
    branchId: uuid().notNull(),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "branch_closure_branch_fk", columns: [t.orgId, t.branchId], foreignColumns: [branch.orgId, branch.id] }),
    check("branch_closure_dates", sql`${t.startDate} <= ${t.endDate}`),
  ],
);
