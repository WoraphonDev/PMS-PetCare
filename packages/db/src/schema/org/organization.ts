import { sql } from "drizzle-orm";
import { check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// docs/spec/features/foundation.md#tbl-organization
export const orgStatus = pgEnum("org_status", ["active", "suspended"]);

export const organization = pgTable(
  "organization",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    displayName: text().notNull(),
    legalName: text(),
    taxId: text(),
    phone: text(),
    logoFileId: uuid(),
    receiptFooter: text(),
    status: orgStatus().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("organization_slug_format", sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check("organization_display_name_length", sql`char_length(${t.displayName}) between 1 and 100`),
    check("organization_tax_id_format", sql`${t.taxId} ~ '^[0-9]{13}$'`),
    check("organization_receipt_footer_length", sql`char_length(${t.receiptFooter}) <= 500`),
  ],
);
