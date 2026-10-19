// ADR-0006 gate: every tenant table must have RLS enabled + forced + at least one policy.
// New tables are picked up automatically — no card may add a table with org_id and skip RLS.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./support/test-db";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 120_000);

afterAll(async () => {
  await t?.stop();
});

it("every table with org_id (and organization) has RLS enabled, forced and a policy", async () => {
  const res = await t.migratorDb.execute(sql`
    select c.relname as table,
           c.relrowsecurity as enabled,
           c.relforcerowsecurity as forced,
           (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (c.relname = 'organization'
           or exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped))
    order by c.relname`);
  const rows = res.rows as { table: string; enabled: boolean; forced: boolean; policies: number }[];

  expect(rows.map((r) => r.table)).toContain("organization");
  expect(rows.map((r) => r.table)).toContain("branch");
  const missing = rows.filter((r) => !r.enabled || !r.forced || r.policies < 1).map((r) => r.table);
  expect(missing, `tables without full RLS: ${missing.join(", ")}`).toEqual([]);
});
