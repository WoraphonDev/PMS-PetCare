import { BranchListResponse } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { call, expectGuardErrors, suspend } from "./support";

// docs/spec/features/foundation.md#ep-branch.list · #rule-branch-list · #contract-branch · F02
let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

const list = (headers: Record<string, string>) => call(app, "GET", "/branches", headers);
const ids = (res: { json(): { items: { id: string }[] } }) => res.json().items.map((b) => b.id);

it("returns { items: Branch[] } with every persisted column in camelCase and numeric coordinates", async () => {
  const o = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  await infra.platformDb.$client.query(
    "update branch set address = 'ถนน 1', phone = '02', latitude = 13.756331, longitude = 100.501765, promptpay_id = '0812345678' where id = $1",
    [o.branchIds[0]],
  );
  const res = await list(o.headers);
  expect(res.statusCode).toBe(200);
  const row = (await infra.platformDb.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, o.branchIds[0]!) }))!;
  expect(BranchListResponse.parse(res.json())).toEqual({
    items: [
      {
        id: o.branchIds[0],
        name: "A",
        address: "ถนน 1",
        phone: "02",
        latitude: 13.756331,
        longitude: 100.501765,
        timezone: "Asia/Bangkok",
        promptpayId: "0812345678",
        isActive: true,
        version: 1,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    ],
  });
});

it("orders by createdAt then id, includes inactive branches and never returns another org's branches", async () => {
  const o = await seedOrg(app, infra, { role: "manager", branches: ["A", "B", "C", "D"] });
  const other = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  const [a, b, c, d] = o.branchIds as [string, string, string, string];
  const set = (id: string, at: string) => infra.platformDb.$client.query("update branch set created_at = $2 where id = $1", [id, at]);
  await set(a, "2026-03-01T00:00:00Z");
  await set(b, "2026-01-01T00:00:00Z");
  await set(c, "2026-02-01T00:00:00Z");
  await set(d, "2026-02-01T00:00:00Z");
  await infra.platformDb.$client.query("update branch set is_active = false where id = $1", [b]);
  const tied = [c, d].sort();
  expect(ids(await list(o.headers))).toEqual([b, ...tied, a]);
  expect((await list(o.headers)).json().items[0].isActive).toBe(false);
  expect(ids(await list(other.headers))).toEqual(other.branchIds);
});

it("shows owner/manager every branch and branch roles only their assigned branches (F02)", async () => {
  for (const role of ["owner", "manager"] as const) {
    const s = await seedOrg(app, infra, { role, branches: ["A", "B"], assignedBranchIndexes: [] });
    expect(ids(await list(s.headers)).sort(), role).toEqual([...s.branchIds].sort());
  }
  for (const role of ["front_desk", "groomer", "caretaker"] as const) {
    const s = await seedOrg(app, infra, { role, branches: ["A", "B", "C"], assignedBranchIndexes: [0, 2] });
    expect(ids(await list(s.headers)).sort(), role).toEqual([s.branchIds[0], s.branchIds[2]].sort());
  }
});

it("still lists branches of a suspended organization (F04)", async () => {
  const s = await seedOrg(app, infra, { role: "groomer", branches: ["A"] });
  await suspend(infra, s.orgId);
  expect(ids(await list(s.headers))).toEqual(s.branchIds);
});

it("applies the org-scoped guard errors", async () => {
  await expectGuardErrors(app, infra, "GET", "/branches");
});
