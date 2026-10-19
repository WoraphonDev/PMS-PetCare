import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// docs/spec/features/foundation.md#tbl-plan — platform-wide (no org_id, no RLS); only app_platform writes it.
export const plan = pgTable(
  "plan",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    name: text().notNull(),
    maxBranches: integer(),
    maxStaff: integer(),
    priceSatangPerMonth: integer().notNull(),
    isActive: boolean().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("plan_price_non_negative", sql`${t.priceSatangPerMonth} >= 0`)],
);
