import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createDb, type Db } from "../../src/client";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

// Roles mirror production (see packages/db/README.md):
//   app_migrator — owns the schema and runs migrations
//   app_runtime  — the API connection; NOBYPASSRLS, so RLS always applies
//   app_platform — cross-organization work (platform admin, outbox worker); BYPASSRLS
const ROLES_SQL = `
  create role app_migrator login password 'migrator';
  create role app_runtime login password 'runtime' nobypassrls;
  create role app_platform login password 'platform' bypassrls;
  grant usage, create on schema public to app_migrator;
  grant usage on schema public to app_runtime, app_platform;
  alter default privileges for role app_migrator in schema public
    grant select, insert, update, delete on tables to app_runtime, app_platform;
  alter default privileges for role app_migrator in schema public
    grant usage, select on sequences to app_runtime, app_platform;
`;

export interface TestDb {
  runtimeDb: Db;
  platformDb: Db;
  migratorDb: Db;
  stop(): Promise<void>;
}

/** Starts Postgres 17, creates the three roles, runs all migrations as app_migrator. */
export async function createTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query(ROLES_SQL);
  // drizzle's migrator keeps its journal in its own schema ("drizzle")
  await admin.query(`grant create on database "${container.getDatabase()}" to app_migrator`);
  await admin.end();

  const url = (user: string, password: string) => {
    const u = new URL(container.getConnectionUri());
    u.username = user;
    u.password = password;
    return u.toString();
  };
  const migratorDb = createDb(url("app_migrator", "migrator"));
  await migrate(migratorDb, { migrationsFolder });
  const runtimeDb = createDb(url("app_runtime", "runtime"));
  const platformDb = createDb(url("app_platform", "platform"));

  return {
    runtimeDb,
    platformDb,
    migratorDb,
    async stop() {
      await Promise.all([runtimeDb.$client.end(), platformDb.$client.end(), migratorDb.$client.end()]);
      await container.stop();
    },
  };
}
