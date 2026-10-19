import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./user";

// Better Auth 1.7 core `session`.
export const session = pgTable(
  "session",
  {
    id: uuid().primaryKey().defaultRandom(),
    token: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);
