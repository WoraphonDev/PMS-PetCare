import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branch, organization, withPlatform, withTenant } from "../src";
import * as schema from "../src/schema";
import { createTestDb, type TestDb } from "./support/test-db";

let t: TestDb;
const A = randomUUID();
const B = randomUUID();

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, slug] of [
    [A, "shop-a"],
    [B, "shop-b"],
  ] as const) {
    await withTenant(t.runtimeDb, id, async (tx) => {
      await tx.insert(organization).values({ id, slug, displayName: slug });
      await tx.insert(branch).values({ orgId: id, name: `${slug} main` });
    });
  }
}, 120_000);

afterAll(async () => {
  await t?.stop();
});

describe("withTenant + RLS", () => {
  it("sees only its own organization and branches", async () => {
    const rows = await withTenant(t.runtimeDb, A, async (tx) => ({
      orgs: await tx.select().from(organization),
      branches: await tx.select().from(branch),
    }));
    expect(rows.orgs.map((o) => o.id)).toEqual([A]);
    expect(rows.branches.map((b) => b.orgId)).toEqual([A]);
  });

  it("sees nothing without a tenant context", async () => {
    expect(await t.runtimeDb.select().from(branch)).toEqual([]);
    expect(await t.runtimeDb.select().from(organization)).toEqual([]);
  });

  it("rejects inserting a row for another organization", async () => {
    const err = await withTenant(t.runtimeDb, A, (tx) => tx.insert(branch).values({ orgId: B, name: "intruder" })).catch((e) => e);
    // drizzle wraps the pg error in `cause`; 42501 = insufficient_privilege raised by the WITH CHECK policy
    expect(err?.cause).toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
  });

  it("cannot update another organization's rows", async () => {
    const updated = await withTenant(t.runtimeDb, A, (tx) =>
      tx.update(branch).set({ name: "hijacked" }).where(eq(branch.orgId, B)).returning(),
    );
    expect(updated).toEqual([]);
    const bNames = await withTenant(t.runtimeDb, B, (tx) => tx.select({ name: branch.name }).from(branch));
    expect(bNames).toEqual([{ name: "shop-b main" }]);
  });

  it("cannot delete another organization's rows", async () => {
    const deleted = await withTenant(t.runtimeDb, A, (tx) => tx.delete(branch).where(eq(branch.orgId, B)).returning());
    expect(deleted).toEqual([]);
  });

  it("does not leak app.org_id from withTenant to the next transaction on the same connection", async () => {
    // A one-connection pool guarantees both transactions run on the same backend.
    const single = drizzle({ client: new pg.Pool({ connectionString: t.runtimeUrl, max: 1 }), schema, casing: "snake_case" });
    try {
      const inside = await withTenant(single, A, async (tx) => {
        const r = await tx.execute(
          sql`select pg_backend_pid() as pid, current_setting('app.org_id', true) as v, (select count(*)::int from branch) as n`,
        );
        return r.rows[0];
      });
      expect(inside).toMatchObject({ v: A, n: 1 });

      const after = await single.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select pg_backend_pid() as pid, current_setting('app.org_id', true) as v, (select count(*)::int from branch) as n`,
        );
        return r.rows[0];
      });
      expect(after).toEqual({ pid: inside?.pid, v: "", n: 0 });
    } finally {
      await single.$client.end();
    }
  });

  it("rejects a non-UUID orgId before touching the database", () => {
    expect(() => withTenant(t.runtimeDb, "' or 1=1 --", async () => undefined)).toThrow(TypeError);
  });

  it("runtime role cannot bypass RLS by itself", async () => {
    const res = await t.runtimeDb.execute(sql`select rolbypassrls from pg_roles where rolname = current_user`);
    expect(res.rows[0]).toEqual({ rolbypassrls: false });
  });
});

describe("withPlatform", () => {
  it("sees every organization", async () => {
    const ids = await withPlatform(t.platformDb, (tx) => tx.select({ id: organization.id }).from(organization));
    expect(ids.map((r) => r.id).sort()).toEqual([A, B].sort());
  });
});
