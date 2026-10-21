import { randomUUID } from "node:crypto";
import { organization, subscription, withTenant, withTenantTx } from "@app/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import { lockBranchLimit } from "../../src/modules/subscription";

// docs/spec/features/foundation.md#rule-branch-capacity — the subscription row is locked FOR UPDATE on the caller's
// tenant transaction before branches are counted.
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});

async function org(maxBranches: number | null | "none", plan: { isActive?: boolean; currentPeriodEnd?: Date } = {}) {
  const orgId = randomUUID();
  await withTenant(db.runtimeDb, orgId, (tx) => tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Shop" }));
  if (maxBranches === "none") return orgId;
  const created = await db.platformDb.$client.query<{ id: string }>(
    "insert into plan (code, name, max_branches, max_staff, price_satang_per_month, is_active) values ($1, 'P', $2, 5, 0, $3) returning id",
    [`test_${randomUUID()}`, maxBranches, plan.isActive ?? true],
  );
  await withTenant(db.runtimeDb, orgId, (tx) =>
    tx
      .insert(subscription)
      .values({ orgId, planId: created.rows[0]!.id, startedAt: new Date(), currentPeriodEnd: plan.currentPeriodEnd ?? null }),
  );
  return orgId;
}
const limitOf = (orgId: string) => withTenant(db.runtimeDb, orgId, (tx) => withTenantTx(tx, orgId, lockBranchLimit));

it("returns max_branches of the organization's plan, null when unlimited", async () => {
  expect(await limitOf(await org(3))).toBe(3);
  expect(await limitOf(await org(null))).toBeNull();
});

it("still returns the limit of an inactive or expired plan (no lifecycle in the MVP)", async () => {
  expect(await limitOf(await org(1, { isActive: false }))).toBe(1);
  expect(await limitOf(await org(2, { currentPeriodEnd: new Date("2020-01-01T00:00:00Z") }))).toBe(2);
});

it("fails closed when the organization has no subscription, even if another org has one", async () => {
  await org(5);
  await expect(limitOf(await org("none"))).rejects.toThrow(/no subscription/);
});

it("holds the subscription row lock until the caller's transaction ends", async () => {
  const orgId = await org(1);
  const events: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const firstLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const first = withTenant(db.runtimeDb, orgId, (tx) =>
    withTenantTx(tx, orgId, async (ctx) => {
      await lockBranchLimit(ctx);
      events.push("first locked");
      locked();
      await held;
      events.push("first commit");
    }),
  );
  await firstLocked;
  const second = limitOf(orgId).then(() => events.push("second locked"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(events).toEqual(["first locked"]);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(["first locked", "first commit", "second locked"]);
});
