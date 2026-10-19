import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext, user } from "../identity/user";
import { staffRole } from "./membership";
import { organization } from "./organization";

// docs/spec/features/foundation.md#tbl-invitation — only the SHA-256 of the token is stored.
// branch_ids cannot carry an FK (array); the use case validates them (F02/F03).
export const invitation = pgTable("invitation", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: uuid()
    .notNull()
    .references(() => organization.id),
  email: citext().notNull(),
  role: staffRole().notNull(),
  branchIds: uuid().array().notNull(),
  tokenHash: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  acceptedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  invitedByUserId: uuid()
    .notNull()
    .references(() => user.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
