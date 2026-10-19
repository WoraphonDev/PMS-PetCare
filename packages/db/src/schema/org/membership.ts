import { pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "../identity/user";
import { organization } from "./organization";

// docs/spec/features/foundation.md#tbl-membership, #roles
export const staffRole = pgEnum("staff_role", ["owner", "manager", "front_desk", "groomer", "caretaker"]);
export const membershipStatus = pgEnum("membership_status", ["active", "removed"]);

export const membership = pgTable(
  "membership",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organization.id),
    userId: uuid()
      .notNull()
      .references(() => user.id),
    role: staffRole().notNull(),
    displayName: text().notNull(),
    status: membershipStatus().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("membership_org_id_user_id_unique").on(t.orgId, t.userId),
    // Target of composite (org_id, membership_id) FKs.
    unique("membership_org_id_id_unique").on(t.orgId, t.id),
  ],
);
