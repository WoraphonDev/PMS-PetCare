import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  auditOf,
  branchRow,
  call,
  closuresOf,
  expectError,
  expectNoBodyRule,
  expectScheduleRouteErrors,
  FIXED_NOW,
  insertClosureRow,
  outboxOf,
  seedHours,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#ep-branch.closure.delete · #contract-branch-schedule-common · #contract-branch-closures ·
// #rule-branch-closure-calendar · #rule-branch-schedule-outbox · #rule-branch-schedule-audit · F02/F04/F07
const failOutbox = vi.hoisted(() => ({ on: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    appendOutbox: async (...args: Parameters<typeof original.appendOutbox>) => {
      if (failOutbox.on) throw new Error("forced outbox failure: secret-detail");
      return original.appendOutbox(...args);
    },
  };
});

let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

const remove = (headers: Record<string, string>, branchId: string, closureId: string) =>
  call(app, "DELETE", `/branches/${branchId}/closures/${closureId}`, headers);
async function seeded(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedHours(infra, s.orgId, s.branchIds);
  await infra.platformDb.$client.query("update branch set promptpay_id = '0812345678' where org_id = $1", [s.orgId]);
  // Overlapping and identical ranges are independent records (G3).
  const closureIds = [
    await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-01", "2026-01-10", "a"),
    await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-05", "2026-01-06"),
    await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-01", "2026-01-10", "a"),
    await insertClosureRow(infra, s.orgId, s.branchIds[1]!, "2026-01-01", "2026-01-10"),
  ];
  return { ...s, closureIds };
}

describe("owner/manager delete a closure", () => {
  for (const role of ["owner", "manager"] as const) {
    it(`${role}: 204 with no body; only the selected record is removed; parent bump + one minimal event; no audit`, async () => {
      const s = await seeded(role);
      const id = s.branchIds[0]!;
      const branchBefore = await branchRow(infra, id);
      const res = await remove(s.headers, id, s.closureIds[0]!);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect((await closuresOf(infra, s.orgId)).map((r) => r.id).sort()).toEqual(s.closureIds.slice(1).sort());
      expect(await branchRow(infra, id)).toEqual({ ...branchBefore, version: 2, updatedAt: FIXED_NOW });
      expect((await branchRow(infra, s.branchIds[1]!)).version).toBe(1);
      const outbox = await outboxOf(infra, s.orgId);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        orgId: s.orgId,
        branchId: id,
        type: "branch.hours_changed",
        aggregateType: "branch",
        aggregateId: id,
        aggregateVersion: 2,
      });
      expect(outbox[0]!.payload).toStrictEqual({ branchId: id, version: 2 });
      expect(outbox[0]!.occurredAt.toISOString()).toBe(FIXED_NOW.toISOString());
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    });
  }

  it("returns NOT_FOUND on a repeated delete, with no second bump or event", async () => {
    const s = await seeded();
    expect((await remove(s.headers, s.branchIds[0]!, s.closureIds[1]!)).statusCode).toBe(204);
    await expectError(await remove(s.headers, s.branchIds[0]!, s.closureIds[1]!), 404, "NOT_FOUND");
    expect((await branchRow(infra, s.branchIds[0]!)).version).toBe(2);
    expect(await outboxOf(infra, s.orgId)).toHaveLength(1);
  });

  it("lets exactly one of two parallel deletes of the same closure succeed", async () => {
    const s = await seeded();
    const results = await Promise.all([1, 2, 3].map(() => remove(s.headers, s.branchIds[0]!, s.closureIds[0]!)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 404, 404]);
    for (const r of results.filter((r) => r.statusCode === 404)) expect(r.json().error.code).toBe("NOT_FOUND");
    expect((await branchRow(infra, s.branchIds[0]!)).version).toBe(2);
    expect((await outboxOf(infra, s.orgId)).map((e) => e.aggregateVersion)).toEqual([2]);
    expect(await closuresOf(infra, s.orgId)).toHaveLength(3);
  });

  it("serializes creates and deletes of different closures on one parent into unique monotonic versions", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const results = await Promise.all([
      remove(s.headers, id, s.closureIds[0]!),
      call(app, "POST", `/branches/${id}/closures`, s.headers, { startDate: "2026-02-01", endDate: "2026-02-01" }),
      remove(s.headers, id, s.closureIds[1]!),
      remove(s.headers, id, s.closureIds[2]!),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([204, 201, 204, 204]);
    const outbox = await outboxOf(infra, s.orgId);
    expect(outbox.map((e) => e.aggregateVersion)).toEqual([2, 3, 4, 5]);
    for (const e of outbox) expect(e.payload).toStrictEqual({ branchId: id, version: e.aggregateVersion });
  });

  it("accepts absent and zero-byte bodies and rejects nonempty ones at `_`", async () => {
    const s = await seeded();
    // T-0040: one more branch-A record for the extra accepted call (empty chunked body without a content-type).
    await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-03-01", "2026-03-01");
    // Each accepted call deletes one record, so the URL always targets a closure of branch A that still exists.
    const url = async () => {
      const left = (await closuresOf(infra, s.orgId)).filter((r) => r.branch_id === s.branchIds[0]);
      return `/branches/${s.branchIds[0]}/closures/${left[0]!.id}`;
    };
    await expectNoBodyRule(app, "DELETE", url, s.headers, 204);
    // Four accepted calls (absent, zero-length, empty chunked without and with text/plain) removed the four branch-A
    // records; rejections none. Branch B's record is left.
    expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
  });
});

describe("rejections write nothing", () => {
  it("denies branch roles with FORBIDDEN on their own assigned branch", async () => {
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      const closureId = await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-01", "2026-01-01");
      await expectError(await remove(s.headers, s.branchIds[0]!, closureId), 403, "FORBIDDEN");
      expect(await closuresOf(infra, s.orgId)).toHaveLength(1);
      expect(await outboxOf(infra, s.orgId)).toEqual([]);
    }
  });

  it("binds the closure to org + branch: wrong branch, other org, absent ids → NOT_FOUND; malformed ids → details.fields", async () => {
    const s = await seeded();
    const other = await seeded();
    const [a, b] = s.branchIds as [string, string];
    const cases: Array<[string, string]> = [
      [b, s.closureIds[0]!], // same-org closure of branch A addressed through branch B
      [a, s.closureIds[3]!], // same-org closure of branch B addressed through branch A
      [a, other.closureIds[0]!],
      [other.branchIds[0]!, other.closureIds[0]!],
      [a, randomUUID()],
      [randomUUID(), s.closureIds[0]!],
    ];
    for (const [branchId, closureId] of cases) {
      const error = await expectError(await remove(s.headers, branchId, closureId), 404, "NOT_FOUND");
      expect(JSON.stringify(error)).not.toContain(other.orgId);
    }
    for (const [branchId, closureId, field] of [
      ["x", s.closureIds[0]!, "branchId"],
      [a, "y", "closureId"],
    ] as const) {
      const error = await expectError(await remove(s.headers, branchId, closureId), 400, "VALIDATION_FAILED");
      expect(error.details).toMatchObject({ fields: { [field]: expect.any(Array) } });
    }
    expect(await closuresOf(infra, s.orgId)).toHaveLength(4);
    expect(await closuresOf(infra, other.orgId)).toHaveLength(4);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
    expect(await outboxOf(infra, other.orgId)).toEqual([]);
    expect((await branchRow(infra, a)).version).toBe(1);
    expect((await branchRow(infra, b)).version).toBe(1);
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await seeded();
    await suspend(infra, s.orgId);
    await expectError(await remove(s.headers, s.branchIds[0]!, s.closureIds[0]!), 423, "ORG_SUSPENDED");
    expect(await closuresOf(infra, s.orgId)).toHaveLength(4);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
  });

  it("rolls back the delete, parent version/updatedAt and the event when the outbox enqueue fails", async () => {
    const s = await seeded();
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    failOutbox.on = true;
    try {
      const error = await expectError(await remove(s.headers, s.branchIds[0]!, s.closureIds[0]!), 500, "INTERNAL");
      expect(error).toStrictEqual({ code: "INTERNAL", message: "Unexpected error" });
    } finally {
      failOutbox.on = false;
    }
    expect(await closuresOf(infra, s.orgId)).toHaveLength(4);
    expect(await branchRow(infra, s.branchIds[0]!)).toEqual(branchBefore);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
    expect(await auditOf(infra, s.orgId)).toEqual([]);
  });

  it("applies the common schedule route errors", async () => {
    await expectScheduleRouteErrors(app, infra, "DELETE", (s) => `/branches/${s.branchIds[0]}/closures/${randomUUID()}`);
  });
});
