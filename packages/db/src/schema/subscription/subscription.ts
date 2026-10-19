import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization } from "../org/organization";
import { plan } from "./plan";

// docs/spec/features/foundation.md#tbl-subscription — one current subscription per org.
export const subscription = pgTable("subscription", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: uuid()
    .notNull()
    .unique()
    .references(() => organization.id),
  planId: uuid()
    .notNull()
    .references(() => plan.id),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp({ withTimezone: true }),
  note: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
