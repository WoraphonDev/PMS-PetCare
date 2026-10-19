import { defineConfig } from "drizzle-kit";

// `generate` needs no database. `migrate` connects as app_migrator via DATABASE_MIGRATOR_URL (see README).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_MIGRATOR_URL ?? "" },
});
