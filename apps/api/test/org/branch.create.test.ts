import { Branch } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg, seedSubscription } from "../support/seed";
import { auditOf, branchesOf, call, expectError, expectGuardErrors, hoursOf, outboxOf, ROLES, suspend } from "./support";

// docs/spec/features/foundation.md#ep-branch.create · #contract-branch · #rule-branch-capacity · #rule-branch-outbox · §6
const failOutbox = vi.hoisted(() => ({ on: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    appendOutbox: async (...args: Parameters<typeof original.appendOutbox>) => {
      if (failOutbox.on) throw new Error("forced outbox failure");
      return original.appendOutbox(...args);
    },
  };
});

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

const create = (headers: Record<string, string>, body: unknown) => call(app, "POST", "/branches", headers, body);
async function ownerWithPlan(maxBranches: number | null, plan: { isActive?: boolean; currentPeriodEnd?: Date | null } = {}) {
  const o = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  await seedSubscription(infra, o.orgId, { maxBranches, ...plan });
  return o;
}
async function expectNothingCreated(orgId: string, branches: number) {
  expect(await branchesOf(infra, orgId)).toHaveLength(branches);
  expect(await hoursOf(infra, orgId)).toEqual([]);
  expect(await auditOf(infra, orgId)).toEqual([]);
  expect(await outboxOf(infra, orgId)).toEqual([]);
}

describe("owner creates a branch", () => {
  it("returns 201 Branch with server defaults, 7 hours rows, branch.created audit and outbox in one commit", async () => {
    const o = await ownerWithPlan(3);
    const res = await create(o.headers, { name: " สาขา 2 ", address: "ถนน 2", phone: "02", latitude: 13.756331, longitude: -100.5 });
    expect(res.statusCode).toBe(201);
    const dto = Branch.parse(res.json());
    expect(dto).toEqual({
      id: expect.any(String),
      name: "สาขา 2",
      address: "ถนน 2",
      phone: "02",
      latitude: 13.756331,
      longitude: -100.5,
      timezone: "Asia/Bangkok",
      promptpayId: null,
      isActive: true,
      version: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(dto.createdAt).toBe(dto.updatedAt);
    const hours = await hoursOf(infra, o.orgId);
    expect(hours.map((h) => [h.branchId, h.weekday, h.opensAt, h.closesAt])).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => [dto.id, weekday, "09:00:00", "18:00:00"]),
    );
    const { promptpayId: _omitted, ...payload } = dto;
    const audit = await auditOf(infra, o.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "branch.created",
      actorUserId: o.userId,
      entityType: "branch",
      entityId: dto.id,
      before: null,
      after: payload,
    });
    const outbox = await outboxOf(infra, o.orgId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      orgId: o.orgId,
      branchId: dto.id,
      type: "branch.created",
      aggregateType: "branch",
      aggregateId: dto.id,
      aggregateVersion: 1,
      payload,
      publishedAt: null,
    });
    expect(outbox[0]!.payload).not.toHaveProperty("promptpayId");
    expect(outbox[0]!.occurredAt.toISOString()).toBe(dto.createdAt);
    expect(audit[0]!.occurredAt.toISOString()).toBe(dto.createdAt);
  });

  it("stores omitted optional fields as null", async () => {
    const o = await ownerWithPlan(null);
    const res = await create(o.headers, { name: "B" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ address: null, phone: null, latitude: null, longitude: null });
  });
});

describe("rejections create nothing", () => {
  it("denies every role except owner", async () => {
    for (const role of ROLES.filter((r) => r !== "owner")) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await seedSubscription(infra, s.orgId, { maxBranches: null });
      await expectError(await create(s.headers, { name: "New" }), 403, "FORBIDDEN");
      await expectNothingCreated(s.orgId, 1);
    }
  });

  it("maps a duplicate name in the same org (exact after trim) to CONFLICT; other orgs may reuse it", async () => {
    const o = await ownerWithPlan(null);
    await expectError(await create(o.headers, { name: " A " }), 409, "CONFLICT");
    await expectNothingCreated(o.orgId, 1);
    const other = await ownerWithPlan(null);
    expect((await create(other.headers, { name: "B" })).statusCode).toBe(201);
    expect((await create(o.headers, { name: "B" })).statusCode).toBe(201);
  });

  it("returns PLAN_LIMIT_REACHED (402) at capacity, counting inactive branches", async () => {
    const o = await ownerWithPlan(1);
    await expectError(await create(o.headers, { name: "B" }), 402, "PLAN_LIMIT_REACHED");
    await expectNothingCreated(o.orgId, 1);

    const two = await ownerWithPlan(2);
    await infra.platformDb.$client.query("update branch set is_active = false where id = $1", [two.branchIds[0]]);
    expect((await create(two.headers, { name: "B" })).statusCode).toBe(201);
    await expectError(await create(two.headers, { name: "C" }), 402, "PLAN_LIMIT_REACHED");
    expect(await branchesOf(infra, two.orgId)).toHaveLength(2);
  });

  it("still enforces max_branches of an inactive or expired plan", async () => {
    for (const plan of [{ isActive: false }, { currentPeriodEnd: new Date("2026-01-02T00:00:00Z") }]) {
      const o = await ownerWithPlan(1, plan);
      await expectError(await create(o.headers, { name: "B" }), 402, "PLAN_LIMIT_REACHED");
      await expectNothingCreated(o.orgId, 1);
    }
  });

  it("fails closed with INTERNAL when the organization has no subscription", async () => {
    const o = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await expectError(await create(o.headers, { name: "B" }), 500, "INTERNAL");
    await expectNothingCreated(o.orgId, 1);
  });

  it("commits at most one branch when concurrent creates race for the last slot", async () => {
    const o = await ownerWithPlan(2);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(o.headers, { name: `Race ${i}` })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 402, 402, 402, 402, 402]);
    for (const r of results.filter((r) => r.statusCode === 402)) expect(r.json().error.code).toBe("PLAN_LIMIT_REACHED");
    expect(await branchesOf(infra, o.orgId)).toHaveLength(2);
    expect(await hoursOf(infra, o.orgId)).toHaveLength(7);
    expect(await auditOf(infra, o.orgId)).toHaveLength(1);
    expect(await outboxOf(infra, o.orgId)).toHaveLength(1);
  });

  it("rejects server-owned fields and invalid input with details.fields", async () => {
    const o = await ownerWithPlan(null);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: "B", promptpayId: "0812345678" }, "promptpayId"],
      [{ name: "B", timezone: "Asia/Bangkok" }, "timezone"],
      [{ name: "B", isActive: false }, "isActive"],
      [{ name: "B", version: 5 }, "version"],
      [{ name: "B", id: o.branchIds[0] }, "id"],
      [{ name: "B", orgId: o.orgId }, "orgId"],
      [{ name: "B", createdAt: "2026-01-01T00:00:00Z" }, "createdAt"],
      [{ name: "B", updatedAt: "2026-01-01T00:00:00Z" }, "updatedAt"],
      [{}, "name"],
      [{ name: "a".repeat(101) }, "name"],
      [{ name: "B", address: "a".repeat(501) }, "address"],
      [{ name: "B", latitude: 91, longitude: 0 }, "latitude"],
      [{ name: "B", latitude: 0, longitude: 180.1 }, "longitude"],
      [{ name: "B", latitude: 13.1234567, longitude: 100 }, "latitude"],
      [{ name: "B", latitude: 13.7 }, "longitude"],
    ];
    for (const [body, field] of cases) {
      const error = await expectError(await create(o.headers, body), 400, "VALIDATION_FAILED");
      expect(error.details, JSON.stringify(body)).toMatchObject({ fields: { [field]: expect.any(Array) } });
    }
    await expectNothingCreated(o.orgId, 1);
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const o = await ownerWithPlan(null);
    await suspend(infra, o.orgId);
    await expectError(await create(o.headers, { name: "B" }), 423, "ORG_SUSPENDED");
    await expectNothingCreated(o.orgId, 1);
  });

  it("rolls back branch, hours and audit when the outbox write fails", async () => {
    const o = await ownerWithPlan(null);
    failOutbox.on = true;
    try {
      await expectError(await create(o.headers, { name: "B" }), 500, "INTERNAL");
    } finally {
      failOutbox.on = false;
    }
    await expectNothingCreated(o.orgId, 1);
  });

  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "POST", "/branches", { name: "Guarded" });
  });
});
