import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branch, organization, withPlatform, withTenant, withTenantTx } from "../src";
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

describe("withTenantTx", () => {
  it("sets the organization context on the caller's transaction without opening another one", async () => {
    const seen = await t.runtimeDb.transaction(async (tx) => {
      const before = await tx.execute(sql`select current_setting('app.org_id', true) as v, pg_backend_pid() as pid`);
      const inside = await withTenantTx(tx, A, async (ctx) => {
        expect(ctx.tx).toBe(tx);
        expect(ctx.orgId).toBe(A);
        const r = await ctx.tx.execute(
          sql`select current_setting('app.org_id', true) as v, pg_backend_pid() as pid, (select count(*)::int from branch) as n`,
        );
        return r.rows[0];
      });
      return { before: before.rows[0], inside };
    });
    expect(seen.before).toMatchObject({ v: "" });
    expect(seen.inside).toMatchObject({ v: A, n: 1, pid: (seen.before as { pid: number }).pid });
  });

  it("denies tenant DML on the caller's transaction before the context is set", async () => {
    const err = await t.runtimeDb.transaction((tx) => tx.insert(branch).values({ orgId: A, name: "no-context" })).catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
  });

  it("denies writing another organization's rows inside the context", async () => {
    const err = await t.runtimeDb
      .transaction((tx) => withTenantTx(tx, A, (ctx) => ctx.tx.insert(branch).values({ orgId: B, name: "intruder-tx" })))
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
  });

  it("sees only its own organization inside the context", async () => {
    const rows = await t.runtimeDb.transaction((tx) =>
      withTenantTx(tx, A, async (ctx) => ({
        orgs: await ctx.tx.select({ id: organization.id }).from(organization),
        branches: await ctx.tx.select({ orgId: branch.orgId }).from(branch),
      })),
    );
    expect(rows.orgs.map((o) => o.id)).toEqual([A]);
    expect(rows.branches.map((b) => b.orgId)).toEqual([A]);
  });

  it("rejects a non-UUID orgId before touching the database", async () => {
    await t.runtimeDb.transaction(async (tx) => {
      expect(() => withTenantTx(tx, "' or 1=1 --", async () => undefined)).toThrow(TypeError);
    });
  });

  it("fails closed on the platform connection (BYPASSRLS) before any DML", async () => {
    const before = await withPlatform(t.platformDb, (tx) => tx.select({ id: branch.id }).from(branch));
    const err = await t.platformDb
      .transaction((tx) => withTenantTx(tx, A, (ctx) => ctx.tx.insert(branch).values({ orgId: A, name: "platform-start" })))
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/refusing to set the organization context/);
    expect(err.cause).toBeUndefined();
    const after = await withPlatform(t.platformDb, (tx) => tx.select({ id: branch.id }).from(branch));
    expect(after.length).toBe(before.length);
  });

  it("fails closed on the migrator connection (table owner) before any DML", async () => {
    const err = await t.migratorDb
      .transaction((tx) => withTenantTx(tx, A, (ctx) => ctx.tx.insert(branch).values({ orgId: A, name: "migrator-start" })))
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/refusing to set the organization context/);
    const rows = await withPlatform(t.platformDb, (tx) => tx.select({ name: branch.name }).from(branch));
    expect(rows.map((r) => r.name)).not.toContain("migrator-start");
  });

  it("cannot escalate from runtime to the platform or migrator role", async () => {
    for (const role of ["app_platform", "app_migrator"]) {
      const err = await t.runtimeDb.transaction((tx) => tx.execute(sql.raw(`set local role ${role}`))).catch((e) => e);
      expect(err?.cause).toMatchObject({ code: "42501" });
    }
  });

  it("clears the context on the same pooled connection after commit, an application throw and a SQL abort", async () => {
    const single = drizzle({ client: new pg.Pool({ connectionString: t.runtimeUrl, max: 1 }), schema, casing: "snake_case" });
    const probe = () =>
      single.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select pg_backend_pid() as pid, current_setting('app.org_id', true) as v, (select count(*)::int from branch) as n`,
        );
        return r.rows[0] as { pid: number; v: string; n: number };
      });
    try {
      const committed = await single.transaction((tx) =>
        withTenantTx(tx, A, async (ctx) => {
          const r = await ctx.tx.execute(sql`select pg_backend_pid() as pid`);
          return (r.rows[0] as { pid: number }).pid;
        }),
      );
      expect(await probe()).toEqual({ pid: committed, v: "", n: 0 });

      const thrown = await single
        .transaction((tx) =>
          withTenantTx(tx, A, async () => {
            throw new Error("application failure");
          }),
        )
        .catch((e) => e);
      expect(thrown.message).toBe("application failure");
      expect(await probe()).toEqual({ pid: committed, v: "", n: 0 });

      const aborted = await single.transaction((tx) => withTenantTx(tx, A, (ctx) => ctx.tx.execute(sql`select 1 / 0`))).catch((e) => e);
      expect(aborted?.cause).toMatchObject({ code: "22012" });
      expect(await probe()).toEqual({ pid: committed, v: "", n: 0 });
    } finally {
      await single.$client.end();
    }
  });
});

describe("withPlatform", () => {
  it("sees every organization", async () => {
    const ids = await withPlatform(t.platformDb, (tx) => tx.select({ id: organization.id }).from(organization));
    expect(ids.map((r) => r.id).sort()).toEqual([A, B].sort());
  });
});
