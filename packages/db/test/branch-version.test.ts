import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branch, createDb, organization, withTenant } from "../src";
import { createTestDb, type TestDb } from "./support/test-db";

// docs/spec/features/foundation.md#tbl-branch, #rule-branch-version (T-0038)

const pgErr = (e: unknown) => (e as { cause?: { code?: string; constraint?: string } })?.cause ?? {};
const caught = (p: Promise<unknown>) => p.then(() => undefined, pgErr);

describe("branch.version on the fully migrated schema", () => {
  let t: TestDb;
  const A = randomUUID();
  const B = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const branchRace = randomUUID();

  const versionOf = (org: string, id: string) =>
    withTenant(t.runtimeDb, org, (tx) => tx.select({ version: branch.version }).from(branch).where(eq(branch.id, id)));

  beforeAll(async () => {
    t = await createTestDb();
    for (const [org, ids] of [
      [A, [branchA, branchRace]],
      [B, [branchB]],
    ] as const) {
      await withTenant(t.runtimeDb, org, async (tx) => {
        await tx.insert(organization).values({ id: org, slug: `org-${org.slice(0, 8)}`, displayName: "x" });
        for (const [i, id] of ids.entries()) await tx.insert(branch).values({ id, orgId: org, name: `b${i}` });
      });
    }
  }, 120_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("is integer not null default 1 with check branch_version_positive and no trigger", async () => {
    const col = await t.migratorDb.execute(sql`
      select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'branch' and column_name = 'version'`);
    expect(col.rows).toEqual([{ data_type: "integer", is_nullable: "NO", column_default: "1" }]);

    const chk = await t.migratorDb.execute(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.branch'::regclass and conname = 'branch_version_positive'`);
    expect(chk.rows).toEqual([{ def: "CHECK ((version >= 1))" }]);

    // Application-owned increment (#org-branch-technical-gates item 4): no user trigger on branch.
    const trg = await t.migratorDb.execute(sql`
      select tgname from pg_trigger where tgrelid = 'public.branch'::regclass and not tgisinternal`);
    expect(trg.rows).toEqual([]);
  });

  it("defaults to 1 when inserted without version", async () => {
    expect(await versionOf(A, branchA)).toEqual([{ version: 1 }]);
    const [row] = await withTenant(t.runtimeDb, A, (tx) =>
      tx.insert(branch).values({ orgId: A, name: "fresh" }).returning({ version: branch.version }),
    );
    expect(row).toEqual({ version: 1 });
  });

  it.each([0, -1])("rejects version = %i with a check violation", async (version) => {
    const err = await caught(withTenant(t.runtimeDb, A, (tx) => tx.insert(branch).values({ orgId: A, name: `v${version}`, version })));
    expect(err).toMatchObject({ code: "23514", constraint: "branch_version_positive" });
  });

  it("rejects null version with a not-null violation", async () => {
    const err = await caught(
      withTenant(t.runtimeDb, A, (tx) => tx.execute(sql`insert into branch (org_id, name, version) values (${A}, 'null-version', null)`)),
    );
    expect(err).toMatchObject({ code: "23502" });
  });

  it("increments in one statement as app_runtime and RLS hides another org's branch", async () => {
    const bump = (org: string, id: string) =>
      withTenant(t.runtimeDb, org, (tx) =>
        tx
          .update(branch)
          .set({ version: sql`${branch.version} + 1` })
          .where(eq(branch.id, id))
          .returning({ version: branch.version }),
      );
    expect(await bump(A, branchA)).toEqual([{ version: 2 }]);
    expect(await bump(A, branchB)).toEqual([]);
    expect(await versionOf(B, branchB)).toEqual([{ version: 1 }]);
  });

  it("serializes concurrent increments on the row lock (2 then 3)", async () => {
    const c1 = new pg.Client({ connectionString: t.runtimeUrl });
    const c2 = new pg.Client({ connectionString: t.runtimeUrl });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      const bump = "update branch set version = version + 1 where id = $1 returning version";
      for (const c of [c1, c2]) {
        await c.query("begin");
        await c.query("select set_config('app.org_id', $1, true)", [A]);
      }
      const first = await c1.query(bump, [branchRace]);
      expect(first.rows).toEqual([{ version: 2 }]);

      let settled = false;
      const second = c2.query(bump, [branchRace]).finally(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(settled).toBe(false); // waiting on c1's row lock

      await c1.query("commit");
      expect((await second).rows).toEqual([{ version: 3 }]);
      await c2.query("commit");
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
    expect(await versionOf(A, branchRace)).toEqual([{ version: 3 }]);
  });
});

// The shared harness only applies every migration at once, so this block orchestrates its own container:
// migrate up to the last migration before T-0038, insert a branch, then apply the rest.
describe("branch.version backfill when migrating an existing database", () => {
  const LAST_BEFORE_T0038 = "0008_rls_org_tables";
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  let container: StartedPostgreSqlContainer;
  let partialFolder: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query(`
      create role app_migrator login password 'migrator';
      create role app_runtime login password 'runtime' nobypassrls;
      create role app_platform login password 'platform' bypassrls;
      grant usage, create on schema public to app_migrator;
      grant usage on schema public to app_runtime, app_platform;
      grant create on database "${container.getDatabase()}" to app_migrator;`);
    await admin.end();

    const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const cut = journal.entries.findIndex((e) => e.tag === LAST_BEFORE_T0038);
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(journal.entries.length).toBeGreaterThan(cut + 1);
    const before = journal.entries.slice(0, cut + 1);
    partialFolder = mkdtempSync(join(tmpdir(), "t0038-migrations-"));
    mkdirSync(join(partialFolder, "meta"));
    writeFileSync(join(partialFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: before }));
    for (const e of before) copyFileSync(join(migrationsFolder, `${e.tag}.sql`), join(partialFolder, `${e.tag}.sql`));
  }, 120_000);

  afterAll(async () => {
    if (partialFolder) rmSync(partialFolder, { recursive: true, force: true });
    await container?.stop();
  });

  it("gives rows that existed before the migration version = 1", async () => {
    const u = new URL(container.getConnectionUri());
    u.username = "app_migrator";
    u.password = "migrator";
    const migratorDb = createDb(u.toString());
    try {
      await migrate(migratorDb, { migrationsFolder: partialFolder });
      const before = await migratorDb.execute(sql`
        select 1 from information_schema.columns where table_name = 'branch' and column_name = 'version'`);
      expect(before.rows).toEqual([]);

      const org = randomUUID();
      const old = randomUUID();
      // Raw SQL: the pre-T-0038 table has no version column. FORCE RLS applies to the owner too.
      await withTenant(migratorDb, org, async (tx) => {
        await tx.execute(sql`insert into organization (id, slug, display_name) values (${org}, 'pre-t0038', 'x')`);
        await tx.execute(sql`insert into branch (id, org_id, name) values (${old}, ${org}, 'old')`);
      });

      await migrate(migratorDb, { migrationsFolder });
      const after = await withTenant(migratorDb, org, (tx) => tx.execute(sql`select version from branch where id = ${old}`));
      expect(after.rows).toEqual([{ version: 1 }]);
    } finally {
      await migratorDb.$client.end();
    }
  });
});
