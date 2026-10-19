import { sql } from "drizzle-orm";
import { boolean, check, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organization } from "./organization";

// docs/spec/features/foundation.md#tbl-branch
export const branch = pgTable(
  "branch",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organization.id),
    name: text().notNull(),
    address: text(),
    phone: text(),
    latitude: numeric({ precision: 9, scale: 6 }),
    longitude: numeric({ precision: 9, scale: 6 }),
    // F06: MVP supports Asia/Bangkok only.
    timezone: text().notNull().default("Asia/Bangkok"),
    promptpayId: text(),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("branch_org_id_name_unique").on(t.orgId, t.name),
    check("branch_timezone_mvp", sql`${t.timezone} = 'Asia/Bangkok'`),
    // F08: mobile 0XXXXXXXXX or 13-digit tax ID (the tax-ID checksum is validated in the use case).
    check("branch_promptpay_id_format", sql`${t.promptpayId} ~ '^(0[0-9]{9}|[0-9]{13})$'`),
  ],
);
