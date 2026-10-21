import { randomUUID } from "node:crypto";
import { Closure } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  auditOf,
  branchHoursOf,
  branchRow,
  call,
  closuresOf,
  expectError,
  expectScheduleRouteErrors,
  expectUnknownKeysRejected,
  FIXED_NOW,
  outboxOf,
  seedHours,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#ep-branch.closure.create · #contract-branch-schedule-common · #contract-branch-closures ·
// #rule-branch-closure-calendar · #rule-branch-schedule-outbox · #rule-branch-schedule-audit · F02/F04/F06/F07
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

const create = (headers: Record<string, string>, id: string, body: unknown) => call(app, "POST", `/branches/${id}/closures`, headers, body);
async function seeded(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedHours(infra, s.orgId, s.branchIds);
  await infra.platformDb.$client.query("update branch set promptpay_id = '0812345678' where org_id = $1", [s.orgId]);
  return s;
}
async function expectNothingWritten(s: Awaited<ReturnType<typeof seeded>>, branchBefore: unknown) {
  expect(await branchRow(infra, s.branchIds[0]!)).toEqual(branchBefore);
  expect(await closuresOf(infra, s.orgId)).toEqual([]);
  expect(await outboxOf(infra, s.orgId)).toEqual([]);
  expect(await auditOf(infra, s.orgId)).toEqual([]);
}

describe("owner/manager create a closure", () => {
  for (const role of ["owner", "manager"] as const) {
    it(`${role}: 201 exact Closure DTO from ctx.now; parent bump + one minimal event without reason; no audit`, async () => {
      const s = await seeded(role);
      const id = s.branchIds[0]!;
      const branchBefore = await branchRow(infra, id);
      const hoursBefore = await branchHoursOf(infra, id);
      const res = await create(s.headers, id, { startDate: "2026-12-30", endDate: "2027-01-02", reason: "  ปิดปีใหม่ 🎉  " });
      expect(res.statusCode).toBe(201);
      const dto = Closure.parse(res.json());
      expect(res.json()).toStrictEqual({
        id: dto.id,
        branchId: id,
        startDate: "2026-12-30",
        endDate: "2027-01-02",
        reason: "ปิดปีใหม่ 🎉",
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString(),
      });
      expect(dto.id).toBe(dto.id.toLowerCase());
      const rows = await closuresOf(infra, s.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: dto.id, branch_id: id, start_date: "2026-12-30", end_date: "2027-01-02", reason: "ปิดปีใหม่ 🎉" });
      expect(rows[0]).toMatchObject({ created_at: FIXED_NOW, updated_at: FIXED_NOW });
      expect(await branchRow(infra, id)).toEqual({ ...branchBefore, version: 2, updatedAt: FIXED_NOW });
      expect(await branchHoursOf(infra, id)).toEqual(hoursBefore);
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
      expect(JSON.stringify(outbox[0]!.payload)).not.toMatch(/ปีใหม่|0812345678/);
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    });
  }

  it("stores omitted and null reason as null and keeps a single-day range inclusive without timezone shift", async () => {
    const s = await seeded();
    for (const body of [
      { startDate: "2026-01-01", endDate: "2026-01-01" },
      { startDate: "2026-12-31", endDate: "2026-12-31", reason: null },
    ]) {
      const res = await create(s.headers, s.branchIds[0]!, body);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ ...body, reason: null });
    }
    expect((await closuresOf(infra, s.orgId)).map((r) => [r.start_date, r.end_date, r.reason])).toEqual([
      ["2026-01-01", "2026-01-01", null],
      ["2026-12-31", "2026-12-31", null],
    ]);
  });

  it("round-trips calendar boundaries 0001/0099/0100/9999 and leap days, accepting past, overlapping and identical ranges", async () => {
    const s = await seeded();
    const ranges = [
      ["0001-01-01", "0001-01-01"],
      ["0099-12-31", "0100-01-01"],
      ["2000-02-29", "2000-02-29"],
      ["2024-02-28", "2024-03-01"],
      ["9999-12-31", "9999-12-31"],
      ["2020-01-01", "2020-01-31"],
      ["2020-01-10", "2020-02-10"],
      ["2020-01-10", "2020-02-10"],
    ];
    for (const [startDate, endDate] of ranges) {
      const res = await create(s.headers, s.branchIds[0]!, { startDate, endDate });
      expect(res.statusCode, `${startDate}..${endDate}`).toBe(201);
      expect(res.json()).toMatchObject({ startDate, endDate });
    }
    const rows = await closuresOf(infra, s.orgId);
    expect(rows).toHaveLength(ranges.length);
    expect(rows.map((r) => [r.start_date, r.end_date])).toEqual([...ranges].sort((a, b) => (a.join() < b.join() ? -1 : a.join() > b.join() ? 1 : 0)));
    expect((await branchRow(infra, s.branchIds[0]!)).version).toBe(ranges.length + 1);
    expect((await outboxOf(infra, s.orgId)).map((e) => e.aggregateVersion)).toEqual(ranges.map((_, i) => i + 2));
  });

  it("accepts reason bounds in code points (500 astral) and stores it trimmed", async () => {
    const s = await seeded();
    const reason = "😀".repeat(500);
    const res = await create(s.headers, s.branchIds[0]!, { startDate: "2026-01-01", endDate: "2026-01-01", reason: ` ${reason}\n` });
    expect(res.statusCode).toBe(201);
    expect(res.json().reason).toBe(reason);
    const { rows } = await infra.platformDb.$client.query("select char_length(reason) as n from branch_closure where org_id = $1", [s.orgId]);
    expect(rows[0].n).toBe(500);
  });

  it("lets simultaneous identical inserts both succeed as independent records with distinct versions and events", async () => {
    const s = await seeded();
    const body = { startDate: "2026-05-01", endDate: "2026-05-03", reason: "same" };
    const results = await Promise.all(Array.from({ length: 4 }, () => create(s.headers, s.branchIds[0]!, body)));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(4);
    expect((await branchRow(infra, s.branchIds[0]!)).version).toBe(5);
    expect((await outboxOf(infra, s.orgId)).map((e) => e.aggregateVersion)).toEqual([2, 3, 4, 5]);
    expect((await branchRow(infra, s.branchIds[1]!)).version).toBe(1);
  });

  it("serializes with branch.update and hours PUT on the same parent: unique monotonic versions", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: "07:00", closesAt: "19:00" }));
    const results = await Promise.all([
      create(s.headers, id, { startDate: "2026-06-01", endDate: "2026-06-01" }),
      call(app, "PATCH", `/branches/${id}`, s.headers, { phone: "099" }),
      create(s.headers, id, { startDate: "2026-06-02", endDate: "2026-06-02" }),
      call(app, "PUT", `/branches/${id}/hours`, s.headers, { items: hours }),
      call(app, "PATCH", `/branches/${id}`, s.headers, { address: "x" }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 200, 201, 200, 200]);
    const outbox = await outboxOf(infra, s.orgId);
    expect(outbox.map((e) => e.aggregateVersion)).toEqual([2, 3, 4, 5, 6]);
    expect(outbox.filter((e) => e.type === "branch.hours_changed")).toHaveLength(3);
    expect(outbox.filter((e) => e.type === "branch.updated")).toHaveLength(2);
    const after = await branchRow(infra, id);
    expect(after).toMatchObject({ version: 6, phone: "099", address: "x", promptpayId: "0812345678", name: "A" });
  });
});

describe("rejections write nothing", () => {
  it("denies branch roles with FORBIDDEN on their own assigned branch", async () => {
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await expectError(await create(s.headers, s.branchIds[0]!, { startDate: "2026-01-01", endDate: "2026-01-01" }), 403, "FORBIDDEN");
      expect(await closuresOf(infra, s.orgId)).toEqual([]);
      expect(await outboxOf(infra, s.orgId)).toEqual([]);
    }
  });

  it("returns NOT_FOUND for another organization's branch and an absent id; malformed id → details.fields.branchId", async () => {
    const s = await seeded();
    const other = await seeded();
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    for (const id of [other.branchIds[0]!, randomUUID()]) {
      await expectError(await create(s.headers, id, { startDate: "2026-01-01", endDate: "2026-01-01" }), 404, "NOT_FOUND");
    }
    const error = await expectError(await create(s.headers, "nope", { startDate: "2026-01-01", endDate: "2026-01-01" }), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { branchId: expect.any(Array) } });
    await expectNothingWritten(s, branchBefore);
    expect(await closuresOf(infra, other.orgId)).toEqual([]);
    expect(await outboxOf(infra, other.orgId)).toEqual([]);
  });

  it("rejects invalid dates, ranges, reasons and unknown keys with details.fields", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const branchBefore = await branchRow(infra, id);
    const ok = { startDate: "2026-01-01", endDate: "2026-01-02" };
    const cases: Array<[unknown, string]> = [
      [{ ...ok, startDate: "1900-02-29" }, "startDate"],
      [{ ...ok, endDate: "2023-02-29" }, "endDate"],
      [{ ...ok, startDate: "0000-01-01" }, "startDate"],
      [{ ...ok, endDate: "+10000-01-01" }, "endDate"],
      [{ ...ok, startDate: "-0001-01-01" }, "startDate"],
      [{ ...ok, endDate: "infinity" }, "endDate"],
      [{ ...ok, startDate: "2026-01-01 BC" }, "startDate"],
      [{ ...ok, startDate: "2026-01-01T00:00:00Z" }, "startDate"],
      [{ ...ok, startDate: "2026-01-01+07:00" }, "startDate"],
      [{ ...ok, startDate: " 2026-01-01" }, "startDate"],
      [{ ...ok, startDate: "2026-04-31" }, "startDate"],
      [{ startDate: "2026-01-02", endDate: "2026-01-01" }, "endDate"],
      [{ endDate: "2026-01-01" }, "startDate"],
      [{ startDate: "2026-01-01" }, "endDate"],
      [{ ...ok, startDate: 20260101 }, "startDate"],
      [{ ...ok, reason: "" }, "reason"],
      [{ ...ok, reason: "   " }, "reason"],
      [{ ...ok, reason: "a".repeat(501) }, "reason"],
      [{ ...ok, reason: "😀".repeat(501) }, "reason"],
      [{ ...ok, reason: "bad\u0000byte" }, "reason"],
      [{ ...ok, reason: 7 }, "reason"],
      [{ ...ok, id: randomUUID() }, "id"],
      [{ ...ok, branchId: id }, "branchId"],
      [{ ...ok, orgId: s.orgId }, "orgId"],
      [{ ...ok, createdAt: FIXED_NOW.toISOString() }, "createdAt"],
      [{ ...ok, version: 1 }, "version"],
      [[], "_"],
      [null, "_"],
    ];
    for (const [body, field] of cases) {
      const res = await app.inject({ method: "POST", url: `/api/v1/branches/${id}/closures`, headers: { ...s.headers, "content-type": "application/json" }, payload: JSON.stringify(body) });
      const error = await expectError(res, 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(body)).toContain(field);
    }
    // A lone surrogate cannot survive JSON.stringify unescaped; send it as a raw JSON escape.
    const lone = await app.inject({
      method: "POST",
      url: `/api/v1/branches/${id}/closures`,
      headers: { ...s.headers, "content-type": "application/json" },
      payload: '{"startDate":"2026-01-01","endDate":"2026-01-01","reason":"a\\ud800b"}',
    });
    expect((await expectError(lone, 400, "VALIDATION_FAILED")).details).toMatchObject({ fields: { reason: expect.any(Array) } });
    await expectUnknownKeysRejected((body) => create(s.headers, id, body), ok);
    await expectNothingWritten(s, branchBefore);
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await seeded();
    await suspend(infra, s.orgId);
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    await expectError(await create(s.headers, s.branchIds[0]!, { startDate: "2026-01-01", endDate: "2026-01-01" }), 423, "ORG_SUSPENDED");
    await expectNothingWritten(s, branchBefore);
  });

  it("rolls back the inserted closure, parent version/updatedAt and the event when the outbox enqueue fails", async () => {
    const s = await seeded();
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    failOutbox.on = true;
    try {
      const error = await expectError(await create(s.headers, s.branchIds[0]!, { startDate: "2026-01-01", endDate: "2026-01-01" }), 500, "INTERNAL");
      expect(error).toStrictEqual({ code: "INTERNAL", message: "Unexpected error" });
    } finally {
      failOutbox.on = false;
    }
    await expectNothingWritten(s, branchBefore);
  });

  it("applies the common schedule route errors", async () => {
    await expectScheduleRouteErrors(app, infra, "POST", (s) => `/branches/${s.branchIds[0]}/closures`, { startDate: "2026-01-01", endDate: "2026-01-01" });
  });
});
