import { randomUUID } from "node:crypto";
import { Branch } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { auditOf, branchesOf, call, expectError, expectGuardErrors, expectUnknownKeysRejected, outboxOf, suspend } from "./support";

// docs/spec/features/foundation.md#ep-branch.update · #contract-branch · #rule-branch-version · #rule-branch-outbox ·
// #org-branch-technical-gates · §6 · §8 (groomer branch.update → FORBIDDEN; other org id → NOT_FOUND)
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

const update = (headers: Record<string, string>, id: string, body: unknown) => call(app, "PATCH", `/branches/${id}`, headers, body);
const rowOf = async (id: string) => (await infra.platformDb.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, id) }))!;
async function seeded(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await infra.platformDb.$client.query("update branch set promptpay_id = '0812345678' where org_id = $1", [s.orgId]);
  return s;
}

describe("owner/manager update a branch", () => {
  for (const role of ["owner", "manager"] as const) {
    it(`${role}: returns 200 Branch, bumps version and writes branch.updated audit + outbox with sorted changedFields`, async () => {
      const s = await seeded(role);
      const id = s.branchIds[0]!;
      const before = await rowOf(id);
      const res = await update(s.headers, id, {
        phone: "02",
        name: " A2 ",
        latitude: 13.5,
        longitude: 100.25,
        isActive: false,
        address: null,
      });
      expect(res.statusCode).toBe(200);
      const after = await rowOf(id);
      const dto = Branch.parse(res.json());
      expect(dto).toEqual({
        id,
        name: "A2",
        address: null,
        phone: "02",
        latitude: 13.5,
        longitude: 100.25,
        timezone: "Asia/Bangkok",
        promptpayId: "0812345678",
        isActive: false,
        version: 2,
        createdAt: before.createdAt.toISOString(),
        updatedAt: after.updatedAt.toISOString(),
      });
      expect(after.version).toBe(2);
      const changedFields = ["isActive", "latitude", "longitude", "name", "phone"];
      const audit = await auditOf(infra, s.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "branch.updated",
        actorUserId: s.userId,
        entityType: "branch",
        entityId: id,
        before: { name: "A", phone: null, latitude: null, longitude: null, isActive: true },
        after: { name: "A2", phone: "02", latitude: 13.5, longitude: 100.25, isActive: false },
      });
      expect(Object.keys(audit[0]!.after!).sort()).toEqual(changedFields);
      const { promptpayId: _omitted, ...payload } = dto;
      const outbox = await outboxOf(infra, s.orgId);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        orgId: s.orgId,
        branchId: id,
        type: "branch.updated",
        aggregateType: "branch",
        aggregateId: id,
        aggregateVersion: 2,
        payload: { ...payload, changedFields },
      });
      expect(outbox[0]!.payload).not.toHaveProperty("promptpayId");
      expect(outbox[0]!.occurredAt.toISOString()).toBe(dto.updatedAt);
    });
  }

  it("treats a no-op PATCH as 200 without UPDATE, version bump, audit or outbox", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const before = await rowOf(id);
    const res = await update(s.headers, id, { name: "A", address: null, latitude: null, longitude: null, isActive: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: 1, updatedAt: before.updatedAt.toISOString() });
    expect(await rowOf(id)).toEqual(before);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
  });

  it("gives every changing PATCH the next version and equal aggregateVersion, also under concurrency", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    expect((await update(s.headers, id, { phone: "1" })).json().version).toBe(2);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => update(s.headers, id, { phone: `p${i}` })));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(results.map((r) => r.json().version).sort()).toEqual([3, 4, 5, 6, 7]);
    expect((await rowOf(id)).version).toBe(7);
    const outbox = await outboxOf(infra, s.orgId);
    expect(outbox.map((e) => e.aggregateVersion)).toEqual([2, 3, 4, 5, 6, 7]);
    for (const e of outbox) expect(e.payload).toMatchObject({ version: e.aggregateVersion, changedFields: ["phone"] });
  });
});

describe("rejections leave the branch unchanged", () => {
  it("denies branch roles even on their own assigned branch", async () => {
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await expectError(await update(s.headers, s.branchIds[0]!, { name: "x" }), 403, "FORBIDDEN");
      expect((await rowOf(s.branchIds[0]!)).version).toBe(1);
    }
  });

  it("returns NOT_FOUND for another organization's branch or an absent id, and VALIDATION_FAILED for a non-UUID", async () => {
    const s = await seeded();
    const other = await seeded();
    await expectError(await update(s.headers, other.branchIds[0]!, { name: "stolen" }), 404, "NOT_FOUND");
    await expectError(await update(s.headers, randomUUID(), { name: "x" }), 404, "NOT_FOUND");
    const error = await expectError(await update(s.headers, "not-a-uuid", { name: "x" }), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: expect.any(Object) });
    expect((await rowOf(other.branchIds[0]!)).name).toBe("A");
    expect(await auditOf(infra, other.orgId)).toEqual([]);
    expect(await outboxOf(infra, other.orgId)).toEqual([]);
  });

  it("rejects promptpayId and server-owned fields with details.fields.<key> without changing persisted values", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const before = await rowOf(id);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ promptpayId: null }, "promptpayId"],
      [{ timezone: "Asia/Tokyo" }, "timezone"],
      [{ version: 9 }, "version"],
      [{ id: randomUUID() }, "id"],
      [{ orgId: randomUUID() }, "orgId"],
      [{ createdAt: "2026-01-01T00:00:00Z" }, "createdAt"],
      [{ updatedAt: "2026-01-01T00:00:00Z" }, "updatedAt"],
      [{ latitude: 13.7 }, "longitude"],
      [{ latitude: null, longitude: 100 }, "latitude"],
      [{ name: null }, "name"],
      [{ isActive: "no" }, "isActive"],
      [{}, "_"],
    ];
    for (const [extra, field] of cases) {
      const body = field === "_" || field === "name" || field === "isActive" ? extra : { name: "changed", ...extra };
      const error = await expectError(await update(s.headers, id, body), 400, "VALIDATION_FAILED");
      expect(error.details, JSON.stringify(body)).toMatchObject({ fields: { [field]: expect.any(Array) } });
    }
    expect(await rowOf(id)).toEqual(before);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("reports unknown keys named like Object.prototype members as VALIDATION_FAILED, not INTERNAL", async () => {
    const s = await seeded();
    const before = await rowOf(s.branchIds[0]!);
    await expectUnknownKeysRejected((body) => update(s.headers, s.branchIds[0]!, body), { name: "changed" });
    expect(await rowOf(s.branchIds[0]!)).toEqual(before);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
  });

  it("maps renaming onto another branch's name to CONFLICT", async () => {
    const s = await seeded();
    await expectError(await update(s.headers, s.branchIds[0]!, { name: " B " }), 409, "CONFLICT");
    expect((await rowOf(s.branchIds[0]!)).version).toBe(1);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await seeded();
    await suspend(infra, s.orgId);
    await expectError(await update(s.headers, s.branchIds[0]!, { name: "x" }), 423, "ORG_SUSPENDED");
    expect((await branchesOf(infra, s.orgId)).map((b) => b.version)).toEqual([1, 1]);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("rolls back the update and its audit when the outbox write fails", async () => {
    const s = await seeded();
    const before = await rowOf(s.branchIds[0]!);
    failOutbox.on = true;
    try {
      await expectError(await update(s.headers, s.branchIds[0]!, { name: "rolled back" }), 500, "INTERNAL");
    } finally {
      failOutbox.on = false;
    }
    expect(await rowOf(s.branchIds[0]!)).toEqual(before);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "PATCH", `/branches/${randomUUID()}`, { name: "x" });
  });
});
