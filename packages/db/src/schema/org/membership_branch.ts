import { foreignKey, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { membership } from "./membership";
import { organization } from "./organization";

// docs/spec/features/foundation.md#tbl-membership_branch — no updated_at.
export const membershipBranch = pgTable(
  "membership_branch",
  {
    orgId: uuid()
      .notNull()
      .references(() => organization.id),
    membershipId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "membership_branch_pk", columns: [t.membershipId, t.branchId] }),
    foreignKey({ name: "membership_branch_branch_fk", columns: [t.orgId, t.branchId], foreignColumns: [branch.orgId, branch.id] }),
    foreignKey({
      name: "membership_branch_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [membership.orgId, membership.id],
    }).onDelete("cascade"),
  ],
);
