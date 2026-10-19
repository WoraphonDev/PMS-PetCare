import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, smallint, time, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { organization } from "./organization";

// docs/spec/features/foundation.md#tbl-branch_hours — 7 rows per branch (created with the branch, card T-0011).
export const branchHours = pgTable(
  "branch_hours",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organization.id),
    branchId: uuid().notNull(),
    weekday: smallint().notNull(),
    opensAt: time(),
    closesAt: time(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "branch_hours_branch_fk", columns: [t.orgId, t.branchId], foreignColumns: [branch.orgId, branch.id] }),
    unique("branch_hours_branch_id_weekday_unique").on(t.branchId, t.weekday),
    check("branch_hours_weekday_iso", sql`${t.weekday} between 1 and 7`),
    check(
      "branch_hours_open_close",
      sql`(${t.opensAt} is null and ${t.closesAt} is null) or (${t.opensAt} is not null and ${t.closesAt} is not null and ${t.opensAt} < ${t.closesAt})`,
    ),
  ],
);
