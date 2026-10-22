import { randomUUID } from "node:crypto";
import { organization, subscription, withTenant, withTenantTx } from "@app/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../../packages/db/test/support/test-db";
import { lockStaffLimit } from "../../src/modules/subscription";

// docs/spec/features/foundation.md#rule-staff-capacity · #rule-staff-check-and-lock step 1 — the subscription row is
// locked FOR UPDATE on the caller's tenant transaction and its plan's max_staff is returned.
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});

async function org(maxStaff: number | null | "none") {
  const orgId = randomUUID();
  await withTenant(db.runtimeDb, orgId, (tx) => tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Shop" }));
  if (maxStaff === "none") return orgId;
  const created = await db.platformDb.$client.query<{ id: string }>(
    "insert into plan (code, name, max_branches, max_staff, price_satang_per_month, is_active) values ($1, 'P', 1, $2, 0, true) returning id",
    [`test_${randomUUID()}`, maxStaff],
  );
  await withTenant(db.runtimeDb, orgId, (tx) =>
    tx.insert(subscription).values({ orgId, planId: created.rows[0]!.id, startedAt: new Date() }),
  );
  return orgId;
}
const limitOf = (orgId: string) => withTenant(db.runtimeDb, orgId, (tx) => withTenantTx(tx, orgId, lockStaffLimit));

it("returns max_staff of the organization's plan, null when unlimited", async () => {
  expect(await limitOf(await org(5))).toBe(5);
  expect(await limitOf(await org(null))).toBeNull();
});

it("fails closed when the organization has no subscription", async () => {
  await expect(limitOf(await org("none"))).rejects.toThrow();
});

it("holds the row lock until the transaction ends, so a second caller waits", async () => {
  const orgId = await org(5);
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const first = withTenant(db.runtimeDb, orgId, (tx) =>
    withTenantTx(tx, orgId, async (ctx) => {
      await lockStaffLimit(ctx);
      order.push("first locked");
      await held;
      order.push("first done");
    }),
  );
  while (order.length === 0) await new Promise((r) => setTimeout(r, 10));
  const second = limitOf(orgId).then(() => order.push("second locked"));
  await new Promise((r) => setTimeout(r, 200));
  expect(order).toEqual(["first locked"]);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["first locked", "first done", "second locked"]);
});
