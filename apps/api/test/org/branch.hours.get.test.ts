import { randomUUID } from "node:crypto";
import { BranchHoursGetResponse } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg, seedSubscription } from "../support/seed";
import {
  auditOf,
  branchHoursOf,
  branchRow,
  call,
  expectError,
  expectNoBodyRule,
  expectScheduleRouteErrors,
  FIXED_NOW,
  outboxOf,
  ROLES,
  seedHours,
  suspend,
  WEEKDAYS,
} from "./support";

// docs/spec/features/foundation.md#contract-branch-hours-get · #contract-branch-hours (G1 projection) ·
// #contract-branch-schedule-common · F02/F04/F07
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
const get = (headers: Record<string, string>, id: string) => call(app, "GET", `/branches/${id}/hours`, headers);
const uniform = (opensAt: string | null, closesAt: string | null): Day[] => WEEKDAYS.map((weekday) => ({ weekday, opensAt, closesAt }));
async function seeded(role: (typeof ROLES)[number] = "owner", assignedBranchIndexes?: number[]) {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"], ...(assignedBranchIndexes ? { assignedBranchIndexes } : {}) });
  await seedHours(infra, s.orgId, s.branchIds);
  return s;
}
async function expectNoWrites(s: Awaited<ReturnType<typeof seeded>>, branchId: string, branchBefore: unknown, hoursBefore: unknown) {
  expect(await branchRow(infra, branchId)).toEqual(branchBefore);
  expect(await branchHoursOf(infra, branchId)).toEqual(hoursBefore);
  expect(await outboxOf(infra, s.orgId)).toEqual([]);
  expect(await auditOf(infra, s.orgId)).toEqual([]);
}

describe("branch.hours.get", () => {
  it("returns the default week (7 × 09:00–18:00) for a branch created through the API", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await seedSubscription(infra, s.orgId, { maxBranches: 3 });
    const created = await call(app, "POST", "/branches", s.headers, { name: "สาขา 2" });
    expect(created.statusCode).toBe(201);
    const res = await get(s.headers, created.json().id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: uniform("09:00", "18:00") });
  });

  it("returns exactly the PUT response after a PUT with a closed day", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const week = uniform("08:30", "17:45").map((d) => (d.weekday === 3 ? { weekday: 3, opensAt: null, closesAt: null } : d));
    const put = await call(app, "PUT", `/branches/${id}/hours`, s.headers, { items: [...week].reverse() });
    expect(put.statusCode).toBe(200);
    const res = await get(s.headers, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual(put.json());
    expect(res.json()).toStrictEqual({ items: week });
  });

  it("is the exact weekday-sorted projection with HH:mm times although the DB stores time", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    // Reverse the physical insert order so sorting cannot come for free from the heap.
    await infra.platformDb.$client.query("delete from branch_hours where branch_id = $1", [id]);
    await infra.platformDb.$client.query(
      "insert into branch_hours (org_id, branch_id, weekday, opens_at, closes_at) select $1, $2, w, '07:05', '23:59' from generate_series(7, 1, -1) w",
      [s.orgId, id],
    );
    expect((await branchHoursOf(infra, id))[0]!.opensAt).toBe("07:05:00");
    const res = await get(s.headers, id);
    expect(res.statusCode).toBe(200);
    BranchHoursGetResponse.parse(res.json());
    expect(res.json()).toStrictEqual({ items: uniform("07:05", "23:59") });
    for (const item of res.json().items) expect(Object.keys(item).sort()).toEqual(["closesAt", "opensAt", "weekday"]);
    expect(Object.keys(res.json())).toEqual(["items"]);
    expect(JSON.stringify(res.json())).not.toContain(id);
    expect(JSON.stringify(res.json())).not.toContain(s.orgId);
  });

  it("lets all five roles read within scope; branch roles get NOT_FOUND on unassigned branches", async () => {
    for (const role of ROLES) {
      const s = await seeded(role, [0]);
      const own = await get(s.headers, s.branchIds[0]!);
      expect(own.statusCode, role).toBe(200);
      expect(own.json(), role).toStrictEqual({ items: uniform("09:00", "18:00") });
      const other = await get(s.headers, s.branchIds[1]!);
      if (role === "owner" || role === "manager") {
        expect(other.statusCode, role).toBe(200);
      } else {
        await expectError(other, 404, "NOT_FOUND");
      }
    }
  });

  it("returns NOT_FOUND for another organization's or an unknown branch; malformed id → details.fields.branchId", async () => {
    const s = await seeded();
    const other = await seeded();
    await infra.platformDb.$client.query("update branch_hours set opens_at = '06:17' where branch_id = $1", [other.branchIds[0]]);
    const res = await get(s.headers, other.branchIds[0]!);
    await expectError(res, 404, "NOT_FOUND");
    expect(res.body).not.toContain("06:17");
    await expectError(await get(s.headers, randomUUID()), 404, "NOT_FOUND");
    const error = await expectError(await get(s.headers, "not-a-uuid"), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { branchId: expect.any(Array) } });
  });

  it("accepts an uppercase branch id", async () => {
    const s = await seeded();
    const res = await get(s.headers, s.branchIds[0]!.toUpperCase());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: uniform("09:00", "18:00") });
  });

  it("still serves reads for a suspended organization", async () => {
    const s = await seeded();
    await suspend(infra, s.orgId);
    const res = await get(s.headers, s.branchIds[0]!);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: uniform("09:00", "18:00") });
  });

  it("returns sanitized INTERNAL without repair when a persisted weekday is missing", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    await infra.platformDb.$client.query("delete from branch_hours where branch_id = $1 and weekday = 4", [id]);
    const branchBefore = await branchRow(infra, id);
    const hoursBefore = await branchHoursOf(infra, id);
    const error = await expectError(await get(s.headers, id), 500, "INTERNAL");
    expect(error).toStrictEqual({ code: "INTERNAL", message: "Unexpected error" });
    expect(hoursBefore).toHaveLength(6);
    await expectNoWrites(s, id, branchBefore, hoursBefore);
  });

  it("writes nothing: branch version/updated_at, hours rows, audit_log and outbox_event unchanged", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const branchBefore = await branchRow(infra, id);
    const hoursBefore = await branchHoursOf(infra, id);
    for (let i = 0; i < 3; i++) expect((await get(s.headers, id)).statusCode).toBe(200);
    await expectNoWrites(s, id, branchBefore, hoursBefore);
    expect((await branchRow(infra, id)).version).toBe(1);
  });

  it("accepts absent and zero-byte bodies and rejects nonempty ones at `_`, without writes", async () => {
    const s = await seeded();
    const id = s.branchIds[0]!;
    const branchBefore = await branchRow(infra, id);
    const hoursBefore = await branchHoursOf(infra, id);
    await expectNoBodyRule(app, "GET", async () => `/branches/${id}/hours`, s.headers, 200);
    await expectNoWrites(s, id, branchBefore, hoursBefore);
  });

  it("applies the common schedule route errors", async () => {
    await expectScheduleRouteErrors(app, infra, "GET", (s) => `/branches/${s.branchIds[0]}/hours`);
  });
});
