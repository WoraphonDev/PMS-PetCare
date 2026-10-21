import { randomUUID } from "node:crypto";
import { BranchHoursPutResponse } from "@app/contracts";
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
  expectError,
  expectScheduleRouteErrors,
  expectUnknownKeysRejected,
  FIXED_NOW,
  outboxOf,
  seedHours,
  suspend,
  WEEKDAYS,
} from "./support";

// docs/spec/features/foundation.md#ep-branch.hours.put · #contract-branch-schedule-common · #contract-branch-hours ·
// #rule-branch-schedule-outbox · #rule-branch-schedule-audit · #rule-branch-version · F02/F04/F07 · §8
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

type Day = { weekday: number; opensAt: string | null; closesAt: string | null };
const put = (headers: Record<string, string>, id: string, body: unknown) => call(app, "PUT", `/branches/${id}/hours`, headers, body);
const uniform = (opensAt: string | null, closesAt: string | null): Day[] => WEEKDAYS.map((weekday) => ({ weekday, opensAt, closesAt }));
const projection = async (branchId: string) =>
  (await branchHoursOf(infra, branchId)).map((h) => ({ weekday: h.weekday, opensAt: h.opensAt, closesAt: h.closesAt }));
async function seeded(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedHours(infra, s.orgId, s.branchIds);
  await infra.platformDb.$client.query("update branch set promptpay_id = '0812345678', phone = '02' where org_id = $1", [s.orgId]);
  return s;
}
async function expectUnchanged(s: Awaited<ReturnType<typeof seeded>>, branchBefore: unknown, hoursBefore: unknown) {
  expect(await branchRow(infra, s.branchIds[0]!)).toEqual(branchBefore);
  expect(await branchHoursOf(infra, s.branchIds[0]!)).toEqual(hoursBefore);
  expect(await outboxOf(infra, s.orgId)).toEqual([]);
  expect(await auditOf(infra, s.orgId)).toEqual([]);
}

describe("owner/manager replace the week", () => {
  for (const role of ["owner", "manager"] as const) {
    it(`${role}: 200 sorted exact projection; only changed rows updated; parent bump + one minimal event; no audit`, async () => {
      const s = await seeded(role);
      const id = s.branchIds[0]!;
      const branchBefore = await branchRow(infra, id);
      const hoursBefore = await branchHoursOf(infra, id);
      const week: Day[] = [
        { weekday: 7, opensAt: null, closesAt: null },
        { weekday: 3, opensAt: "00:00", closesAt: "23:59" },
        { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
        { weekday: 5, opensAt: "10:30", closesAt: "12:00" },
        { weekday: 2, opensAt: "09:00", closesAt: "18:00" },
        { weekday: 6, opensAt: null, closesAt: null },
        { weekday: 4, opensAt: "09:00", closesAt: "18:00" },
      ];
      const res = await put(s.headers, id, { items: week });
      expect(res.statusCode).toBe(200);
      const sorted = [...week].sort((a, b) => a.weekday - b.weekday);
      expect(res.json()).toStrictEqual({ items: sorted });
      BranchHoursPutResponse.parse(res.json());
      for (const item of res.json().items) expect(Object.keys(item).sort()).toEqual(["closesAt", "opensAt", "weekday"]);

      const hoursAfter = await branchHoursOf(infra, id);
      expect(hoursAfter.map((h) => [h.weekday, h.opensAt, h.closesAt])).toEqual(
        sorted.map((d) => [d.weekday, d.opensAt && `${d.opensAt}:00`, d.closesAt && `${d.closesAt}:00`]),
      );
      for (const [i, h] of hoursAfter.entries()) {
        const before = hoursBefore[i]!;
        expect(h.id).toBe(before.id);
        expect(h.createdAt).toEqual(before.createdAt);
        const changed = [3, 5, 6, 7].includes(h.weekday);
        expect(h.updatedAt.toISOString(), `weekday ${h.weekday}`).toBe(changed ? FIXED_NOW.toISOString() : before.updatedAt.toISOString());
      }
      const branchAfter = await branchRow(infra, id);
      expect(branchAfter).toEqual({ ...branchBefore, version: 2, updatedAt: FIXED_NOW });
      expect(branchAfter.promptpayId).toBe("0812345678");
      expect(branchAfter.phone).toBe("02");
      expect(branchAfter.name).toBe("A");

      const outbox = await outboxOf(infra, s.orgId);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        orgId: s.orgId,
        branchId: id,
        type: "branch.hours_changed",
        aggregateType: "branch",
        aggregateId: id,
        aggregateVersion: 2,
        publishedAt: null,
      });
      expect(outbox[0]!.payload).toStrictEqual({ branchId: id, version: 2 });
      expect(outbox[0]!.occurredAt.toISOString()).toBe(FIXED_NOW.toISOString());
      expect(await auditOf(infra, s.orgId)).toEqual([]);
      expect((await branchRow(infra, s.branchIds[1]!)).version).toBe(1);
    });
  }

  it("accepts an all-closed week", async () => {
    const s = await seeded();
    const res = await put(s.headers, s.branchIds[0]!, { items: uniform(null, null) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: uniform(null, null) });
    expect(await projection(s.branchIds[0]!)).toEqual(uniform(null, null));
  });

  it("treats a semantically equal week as a no-op: 200 projection, no row/parent/timestamp change, no event or audit", async () => {
    const s = await seeded();
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    const hoursBefore = await branchHoursOf(infra, s.branchIds[0]!);
    const res = await put(s.headers, s.branchIds[0]!, { items: [...uniform("09:00", "18:00")].reverse() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: uniform("09:00", "18:00") });
    await expectUnchanged(s, branchBefore, hoursBefore);
  });

  it("does not truncate persisted seconds into a fake no-op: 09:00:30 vs 09:00 is a change", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    await infra.platformDb.$client.query("update branch_hours set opens_at = '09:00:30' where branch_id = $1 and weekday = 4", [id]);
    await infra.platformDb.$client.query("update branch_hours set closes_at = '18:00:00.25' where branch_id = $1 and weekday = 6", [id]);
    const res = await put(s.headers, id, { items: uniform("09:00", "18:00") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: uniform("09:00", "18:00") });
    const hours = await branchHoursOf(infra, id);
    expect(hours.map((h) => [h.opensAt, h.closesAt])).toEqual(WEEKDAYS.map(() => ["09:00:00", "18:00:00"]));
    expect(hours.filter((h) => h.updatedAt.getTime() === FIXED_NOW.getTime()).map((h) => h.weekday)).toEqual([4, 6]);
    expect((await branchRow(infra, id)).version).toBe(2);
    expect((await outboxOf(infra, s.orgId)).map((e) => e.aggregateVersion)).toEqual([2]);
  });

  it("returns sanitized INTERNAL without repair when a persisted weekday is missing", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    await infra.platformDb.$client.query("delete from branch_hours where branch_id = $1 and weekday = 7", [id]);
    const branchBefore = await branchRow(infra, id);
    const hoursBefore = await branchHoursOf(infra, id);
    const error = await expectError(await put(s.headers, id, { items: uniform("08:00", "17:00") }), 500, "INTERNAL");
    expect(error).toStrictEqual({ code: "INTERNAL", message: "Unexpected error" });
    expect(hoursBefore).toHaveLength(6);
    await expectUnchanged(s, branchBefore, hoursBefore);
  });

  it("serializes parallel replacements: never a mixed week, unique monotonic versions, one event per effective write", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const weeks = [1, 2, 3, 4, 5, 6].map((i) => uniform(`0${i}:00`, `1${i}:00`));
    const results = await Promise.all(weeks.map((items) => put(s.headers, id, { items })));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
    const final = await projection(id);
    expect(new Set(final.map((d) => `${d.opensAt}-${d.closesAt}`)).size).toBe(1);
    expect(weeks.map((w) => w.map((d) => `${d.opensAt}:00-${d.closesAt}:00`)[0])).toContain(`${final[0]!.opensAt}-${final[0]!.closesAt}`);
    expect((await branchRow(infra, id)).version).toBe(7);
    const outbox = await outboxOf(infra, s.orgId);
    expect(outbox.map((e) => e.aggregateVersion)).toEqual([2, 3, 4, 5, 6, 7]);
    for (const e of outbox) expect(e.payload).toStrictEqual({ branchId: id, version: e.aggregateVersion });
    expect((await branchRow(infra, s.branchIds[1]!)).version).toBe(1);
  });
});

describe("rejections change nothing", () => {
  it("denies branch roles with FORBIDDEN on their own assigned branch", async () => {
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await seedHours(infra, s.orgId, s.branchIds);
      await expectError(await put(s.headers, s.branchIds[0]!, { items: uniform("08:00", "17:00") }), 403, "FORBIDDEN");
      expect((await branchRow(infra, s.branchIds[0]!)).version).toBe(1);
      expect(await outboxOf(infra, s.orgId)).toEqual([]);
    }
  });

  it("returns NOT_FOUND for another organization's branch and an absent id; malformed id → details.fields.branchId", async () => {
    const s = await seeded();
    const other = await seeded();
    const otherBefore = await branchHoursOf(infra, other.branchIds[0]!);
    for (const id of [other.branchIds[0]!, randomUUID()]) {
      const error = await expectError(await put(s.headers, id, { items: uniform("08:00", "17:00") }), 404, "NOT_FOUND");
      expect(JSON.stringify(error)).not.toContain(other.orgId);
    }
    const error = await expectError(await put(s.headers, "not-a-uuid", { items: uniform("08:00", "17:00") }), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { branchId: expect.any(Array) } });
    expect(await branchHoursOf(infra, other.branchIds[0]!)).toEqual(otherBefore);
    expect(await outboxOf(infra, other.orgId)).toEqual([]);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
  });

  it("accepts an upper-case branch UUID as the same branch", async () => {
    const s = await seeded();
    const res = await put(s.headers, s.branchIds[0]!.toUpperCase(), { items: uniform("08:00", "17:00") });
    expect(res.statusCode).toBe(200);
    expect((await outboxOf(infra, s.orgId))[0]).toMatchObject({ aggregateId: s.branchIds[0], payload: { branchId: s.branchIds[0] } });
  });

  it("rejects invalid bodies with VALIDATION_FAILED and dotted details.fields", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const branchBefore = await branchRow(infra, id);
    const hoursBefore = await branchHoursOf(infra, id);
    const week = uniform("09:00", "18:00");
    const at = (i: number, item: unknown) => ({ items: week.map((d, j) => (i === j ? item : d)) });
    const cases: Array<[unknown, string]> = [
      [{ items: week.slice(0, 6) }, "items"],
      [{ items: [...week, { weekday: 1, opensAt: "09:00", closesAt: "18:00" }] }, "items"],
      [at(6, { weekday: 1, opensAt: "09:00", closesAt: "18:00" }), "items.6.weekday"],
      [at(0, { weekday: 0, opensAt: "09:00", closesAt: "18:00" }), "items.0.weekday"],
      [at(0, { weekday: 8, opensAt: "09:00", closesAt: "18:00" }), "items.0.weekday"],
      [at(0, { weekday: 1.5, opensAt: "09:00", closesAt: "18:00" }), "items.0.weekday"],
      [at(0, { weekday: "1", opensAt: "09:00", closesAt: "18:00" }), "items.0.weekday"],
      [at(0, { weekday: 1, opensAt: null, closesAt: "18:00" }), "items.0.opensAt"],
      [at(0, { weekday: 1, opensAt: "09:00", closesAt: null }), "items.0.closesAt"],
      [at(0, { weekday: 1, opensAt: "09:00", closesAt: "09:00" }), "items.0.closesAt"],
      [at(0, { weekday: 1, opensAt: "18:00", closesAt: "09:00" }), "items.0.closesAt"],
      [at(0, { weekday: 1, opensAt: "22:00", closesAt: "02:00" }), "items.0.closesAt"],
      [at(0, { weekday: 1, opensAt: "24:00", closesAt: "23:59" }), "items.0.opensAt"],
      [at(0, { weekday: 1, opensAt: "09:00:00", closesAt: "18:00" }), "items.0.opensAt"],
      [at(0, { weekday: 1, opensAt: "9:00", closesAt: "18:00" }), "items.0.opensAt"],
      [at(0, { weekday: 1, opensAt: "09:00", closesAt: " 18:00" }), "items.0.closesAt"],
      [at(0, { weekday: 1, opensAt: 900, closesAt: "18:00" }), "items.0.opensAt"],
      [at(0, { weekday: 1, closesAt: "18:00" }), "items.0.opensAt"],
      [at(0, { weekday: 1, opensAt: "09:00", closesAt: "18:00", id: randomUUID() }), "items.0.id"],
      [at(0, { weekday: 1, opensAt: "09:00", closesAt: "18:00", orgId: randomUUID() }), "items.0.orgId"],
      [at(0, null), "items.0"],
      [{}, "items"],
      [{ items: null }, "items"],
      [{ items: week, branchId: id }, "branchId"],
      [{ items: week, version: 3 }, "version"],
      [[], "_"],
      [null, "_"],
    ];
    for (const [body, field] of cases) {
      const res = await app.inject({ method: "PUT", url: `/api/v1/branches/${id}/hours`, headers: { ...s.headers, "content-type": "application/json" }, payload: JSON.stringify(body) });
      const error = await expectError(res, 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(body)).toContain(field);
    }
    await expectUnknownKeysRejected((body) => put(s.headers, id, body), { items: week });
    await expectUnknownKeysRejected((body) => put(s.headers, id, { items: week.map((d, i) => (i === 2 ? { ...d, ...body } : d)) }).then(nestedAsRoot), {});
    await expectUnchanged(s, branchBefore, hoursBefore);
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await seeded();
    await suspend(infra, s.orgId);
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    const hoursBefore = await branchHoursOf(infra, s.branchIds[0]!);
    await expectError(await put(s.headers, s.branchIds[0]!, { items: uniform("08:00", "17:00") }), 423, "ORG_SUSPENDED");
    await expectUnchanged(s, branchBefore, hoursBefore);
  });

  it("rolls back changed rows, parent version/updatedAt and the event when the outbox enqueue fails", async () => {
    const s = await seeded();
    const branchBefore = await branchRow(infra, s.branchIds[0]!);
    const hoursBefore = await branchHoursOf(infra, s.branchIds[0]!);
    failOutbox.on = true;
    try {
      const error = await expectError(await put(s.headers, s.branchIds[0]!, { items: uniform("08:00", "17:00") }), 500, "INTERNAL");
      expect(JSON.stringify(error)).not.toContain("secret-detail");
    } finally {
      failOutbox.on = false;
    }
    await expectUnchanged(s, branchBefore, hoursBefore);
  });

  it("applies the common schedule route errors", async () => {
    await expectScheduleRouteErrors(app, infra, "PUT", (s) => `/branches/${s.branchIds[0]}/hours`, { items: uniform("08:00", "17:00") });
  });
});

/** Re-keys nested `items.2.<key>` field errors to `<key>` so the shared prototype-key helper can assert them. */
function nestedAsRoot(res: Awaited<ReturnType<typeof call>>) {
  const body = res.json() as { error?: { details?: { fields?: Record<string, unknown> } } };
  const fields = body.error?.details?.fields;
  if (!fields) return res;
  const rekeyed: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(fields)) rekeyed[k.replace(/^items\.2\./, "")] = v;
  return { ...res, statusCode: res.statusCode, json: () => ({ ...body, error: { ...body.error, details: { fields: rekeyed } } }) } as typeof res;
}
