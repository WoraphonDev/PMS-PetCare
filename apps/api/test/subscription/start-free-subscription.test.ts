import { randomUUID } from "node:crypto";
import { plan, seedPlans, user, withPlatform, withTenantTx } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Reuses @app/db's harness (roles, migrations, RLS) — test-only, not part of the package API.
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import { bootstrapOrganization } from "../../src/modules/org";
import { startFreeSubscription } from "../../src/modules/subscription";

let t: TestDb;
const NOW = new Date("2026-10-21T03:00:00.000Z");

beforeAll(async () => {
  t = await createTestDb();
  await withPlatform(t.platformDb, seedPlans);
}, 180_000);

afterAll(async () => {
  await t?.stop();
});

/** Creates an organization with its owner so the subscription has a valid org to attach to. */
async function seedBootstrappedOrg(): Promise<string> {
  const orgId = randomUUID();
  const [owner] = await withPlatform(t.platformDb, (tx) =>
    tx
      .insert(user)
      .values({ name: "เจ้าของร้าน", email: `${randomUUID()}@example.com` })
      .returning({ id: user.id }),
  );
  await t.runtimeDb.transaction((tx) =>
    withTenantTx(tx, orgId, (ctx) =>
      bootstrapOrganization(ctx, {
        slug: `shop-${randomUUID().slice(0, 8)}`,
        displayName: "ร้านทดสอบ",
        branchName: "สาขาหลัก",
        ownerUserId: owner!.id,
        ownerDisplayName: "เจ้าของ",
      }),
    ),
  );
  return orgId;
}

const subsOf = (orgId: string) =>
  withPlatform(t.platformDb, (tx) => tx.query.subscription.findMany({ where: (s, { eq }) => eq(s.orgId, orgId) }));

const freePlan = () => withPlatform(t.platformDb, (tx) => tx.query.plan.findMany({ where: (p, { eq }) => eq(p.code, "mvp_free") }));

describe("startFreeSubscription", () => {
  it("creates one mvp_free subscription with the injected clock and no period end", async () => {
    const orgId = await seedBootstrappedOrg();
    const [expected] = await freePlan();

    const result = await t.runtimeDb.transaction((tx) => withTenantTx(tx, orgId, (ctx) => startFreeSubscription(ctx, orgId, NOW)));

    expect(result.planId).toBe(expected!.id);
    const rows = await subsOf(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: result.subscriptionId, planId: expected!.id, startedAt: NOW, currentPeriodEnd: null, note: null });
  });

  it("does not modify or reseed the plan catalogue", async () => {
    const before = await freePlan();
    const orgId = await seedBootstrappedOrg();
    await t.runtimeDb.transaction((tx) => withTenantTx(tx, orgId, (ctx) => startFreeSubscription(ctx, orgId, NOW)));
    expect(await freePlan()).toEqual(before);
    expect(before[0]).toMatchObject({ maxBranches: 1, maxStaff: 5, priceSatangPerMonth: 0, isActive: true });
    const all = await withPlatform(t.platformDb, (tx) => tx.query.plan.findMany());
    expect(all.map((p) => p.code)).toEqual(["mvp_free"]);
  });

  it("cannot write the plan catalogue from the runtime connection", async () => {
    const err = await t.runtimeDb
      .transaction((tx) => tx.insert(plan).values({ code: "sneaky", name: "x", priceSatangPerMonth: 0, isActive: true }))
      .catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "42501" });
  });

  it("fails closed when the mvp_free plan is inactive", async () => {
    const orgId = await seedBootstrappedOrg();
    await t.platformDb.$client.query("update plan set is_active = false where code = 'mvp_free'");
    try {
      const err = await t.runtimeDb
        .transaction((tx) => withTenantTx(tx, orgId, (ctx) => startFreeSubscription(ctx, orgId, NOW)))
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/no active mvp_free plan/);
      expect(await subsOf(orgId)).toEqual([]);
    } finally {
      await t.platformDb.$client.query("update plan set is_active = true where code = 'mvp_free'");
    }
  });

  it("fails closed when no plan with code mvp_free exists", async () => {
    const orgId = await seedBootstrappedOrg();
    await t.platformDb.$client.query("update plan set code = 'mvp_free_archived' where code = 'mvp_free'");
    try {
      const err = await t.runtimeDb
        .transaction((tx) => withTenantTx(tx, orgId, (ctx) => startFreeSubscription(ctx, orgId, NOW)))
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/no active mvp_free plan/);
      expect(await subsOf(orgId)).toEqual([]);
    } finally {
      await t.platformDb.$client.query("update plan set code = 'mvp_free' where code = 'mvp_free_archived'");
    }
  });

  it("refuses an organization that is not the transaction context", async () => {
    const orgId = await seedBootstrappedOrg();
    const other = await seedBootstrappedOrg();
    const err = await t.runtimeDb
      .transaction((tx) => withTenantTx(tx, orgId, (ctx) => startFreeSubscription(ctx, other, NOW)))
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/does not match the transaction context/);
    expect(await subsOf(orgId)).toEqual([]);
    expect(await subsOf(other)).toEqual([]);
  });

  it("is denied without an organization context", async () => {
    const orgId = await seedBootstrappedOrg();
    const err = await t.runtimeDb.transaction((tx) => startFreeSubscription({ tx, orgId }, orgId, NOW)).catch((e) => e);
    expect(err?.cause).toMatchObject({ code: "42501", message: expect.stringMatching(/row-level security/) });
    expect(await subsOf(orgId)).toEqual([]);
  });

  it("rolls back with the caller's transaction", async () => {
    const orgId = await seedBootstrappedOrg();
    const err = await t.runtimeDb
      .transaction((tx) =>
        withTenantTx(tx, orgId, async (ctx) => {
          await startFreeSubscription(ctx, orgId, NOW);
          throw new Error("caller failure");
        }),
      )
      .catch((e) => e);
    expect(err.message).toBe("caller failure");
    expect(await subsOf(orgId)).toEqual([]);
    // The organization itself stays untouched: the caller owns the transaction, not the service.
    expect(
      await withPlatform(t.platformDb, (tx) => tx.query.organization.findMany({ where: (o, { eq }) => eq(o.id, orgId) })),
    ).toHaveLength(1);
  });
});
