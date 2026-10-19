import { sql } from "drizzle-orm";
import { boolean, check, customType, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization } from "../org/organization";

// Case-insensitive text (extension created in migration 0005).
export const citext = customType<{ data: string }>({ dataType: () => "citext" });

// docs/spec/features/foundation.md#tbl-identity — Better Auth 1.7 core `user` + plugins `username`, `twoFactor`
// + our columns. ids are uuid so every FK to a user has one type. No org_id → no RLS (ADR-0003).
export const user = pgTable(
  "user",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    // Managed accounts (F09) store `<user_id>@managed.invalid` — never mailed, never shown.
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    username: citext().unique(),
    displayUsername: text(),
    twoFactorEnabled: boolean().notNull().default(false),
    isPlatformAdmin: boolean().notNull().default(false),
    isManaged: boolean().notNull().default(false),
    managedByOrgId: uuid().references(() => organization.id),
    mustChangePassword: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("user_username_format", sql`${t.username} ~ '^[a-z0-9._-]{3,40}$'`),
    check("user_managed_has_org", sql`not ${t.isManaged} or ${t.managedByOrgId} is not null`),
  ],
);
