import { randomUUID } from "node:crypto";
import { BranchClosureListResponse } from "@app/contracts";
import { withTenant } from "@app/db";
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
  expectNoBodyRule,
  expectScheduleRouteErrors,
  FIXED_NOW,
  insertClosureRow,
  outboxOf,
  ROLES,
  seedHours,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#ep-branch.closure.list · #contract-branch-schedule-common · #contract-branch-closures ·
// #rule-branch-closure-calendar · F02/F04/F07 · ADR-0003 (runtime role, RLS)
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

const list = (headers: Record<string, string>, id: string) => call(app, "GET", `/branches/${id}/closures`, headers);
async function seeded(role: (typeof ROLES)[number] = "owner", assignedBranchIndexes?: number[]) {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"], ...(assignedBranchIndexes ? { assignedBranchIndexes } : {}) });
  await seedHours(infra, s.orgId, s.branchIds);
  return s;
}
async function expectNoWrites(s: Awaited<ReturnType<typeof seeded>>, before: unknown) {
  expect(await branchRow(infra, s.branchIds[0]!)).toEqual(before);
  expect(await outboxOf(infra, s.orgId)).toEqual([]);
  expect(await auditOf(infra, s.orgId)).toEqual([]);
}

describe("branch.closure.list", () => {
  it("returns every record of the branch (past, overlapping, identical) ordered startDate, endDate, id as exact DTOs", async () => {
    const s = await seeded();
    const [a, b] = s.branchIds as [string, string];
    const ids = {
      late: await insertClosureRow(infra, s.orgId, a, "2026-03-01", "2026-03-02"),
      past: await insertClosureRow(infra, s.orgId, a, "0001-01-01", "0001-01-01", "ancient"),
      wideA: await insertClosureRow(infra, s.orgId, a, "2026-01-01", "2026-01-10", "x"),
      wideB: await insertClosureRow(infra, s.orgId, a, "2026-01-01", "2026-01-10", "x"),
      short: await insertClosureRow(infra, s.orgId, a, "2026-01-01", "2026-01-02"),
      max: await insertClosureRow(infra, s.orgId, a, "9999-12-31", "9999-12-31"),
    };
    await insertClosureRow(infra, s.orgId, b, "2026-01-01", "2026-01-01");
    const timestamps = await infra.platformDb.$client.query<{ id: string; created_at: Date; updated_at: Date }>(
      "select id, created_at, updated_at from branch_closure where branch_id = $1",
      [a],
    );
    const ts = new Map(timestamps.rows.map((r) => [r.id, r]));
    const before = await branchRow(infra, a);
    const res = await list(s.headers, a);
    expect(res.statusCode).toBe(200);
    BranchClosureListResponse.parse(res.json());
    const [wide1, wide2] = [ids.wideA, ids.wideB].sort();
    const order = [ids.past, ids.short, wide1, wide2, ids.late, ids.max];
    expect(res.json().items.map((c: { id: string }) => c.id)).toEqual(order);
    const byId = new Map(res.json().items.map((c: { id: string }) => [c.id, c]));
    expect(byId.get(ids.past)).toStrictEqual({
      id: ids.past,
      branchId: a,
      startDate: "0001-01-01",
      endDate: "0001-01-01",
      reason: "ancient",
      createdAt: ts.get(ids.past)!.created_at.toISOString(),
      updatedAt: ts.get(ids.past)!.updated_at.toISOString(),
    });
    expect(byId.get(ids.short)).toMatchObject({ reason: null, startDate: "2026-01-01", endDate: "2026-01-02" });
    expect(byId.get(ids.max)).toMatchObject({ startDate: "9999-12-31", endDate: "9999-12-31" });
    for (const item of res.json().items) {
      expect(Object.keys(item).sort()).toEqual(["branchId", "createdAt", "endDate", "id", "reason", "startDate", "updatedAt"]);
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(JSON.stringify(res.json())).not.toContain(s.orgId);
    await expectNoWrites(s, before);
  });

  it("returns an empty list for a branch without closures, after checking the parent exists", async () => {
    const s = await seeded();
    const res = await list(s.headers, s.branchIds[0]!);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ items: [] });
    await expectError(await list(s.headers, randomUUID()), 404, "NOT_FOUND");
  });

  it("lets all five roles read within scope; branch roles get NOT_FOUND on unassigned branches", async () => {
    for (const role of ROLES) {
      const s = await seeded(role, [0]);
      await insertClosureRow(infra, s.orgId, s.branchIds[1]!, "2026-01-01", "2026-01-01");
      const own = await list(s.headers, s.branchIds[0]!);
      expect(own.statusCode, role).toBe(200);
      const other = await list(s.headers, s.branchIds[1]!);
      if (role === "owner" || role === "manager") {
        expect(other.statusCode, role).toBe(200);
        expect(other.json().items).toHaveLength(1);
      } else {
        await expectError(other, 404, "NOT_FOUND");
      }
    }
  });

  it("returns NOT_FOUND for another organization's branch without leaking its records; malformed id → details.fields.branchId", async () => {
    const s = await seeded();
    const other = await seeded();
    await insertClosureRow(infra, other.orgId, other.branchIds[0]!, "2026-01-01", "2026-01-01", "secret-reason");
    const res = await list(s.headers, other.branchIds[0]!);
    await expectError(res, 404, "NOT_FOUND");
    expect(res.body).not.toContain("secret-reason");
    const error = await expectError(await list(s.headers, "not-a-uuid"), 400, "VALIDATION_FAILED");
    expect(error.details).toMatchObject({ fields: { branchId: expect.any(Array) } });
  });

  it("still serves reads for a suspended organization", async () => {
    const s = await seeded();
    await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-01", "2026-01-01");
    await suspend(infra, s.orgId);
    const res = await list(s.headers, s.branchIds[0]!);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it("accepts absent and zero-byte bodies and rejects nonempty ones at `_`, without writes", async () => {
    const s = await seeded();
    const before = await branchRow(infra, s.branchIds[0]!);
    const hours = await branchHoursOf(infra, s.branchIds[0]!);
    await expectNoBodyRule(app, "GET", async () => `/branches/${s.branchIds[0]}/closures`, s.headers, 200);
    await expectNoWrites(s, before);
    expect(await branchHoursOf(infra, s.branchIds[0]!)).toEqual(hours);
  });

  it("runs on a non-superuser NOBYPASSRLS runtime role that cannot see closures without or outside its tenant context", async () => {
    const s = await seeded();
    const other = await seeded();
    await insertClosureRow(infra, s.orgId, s.branchIds[0]!, "2026-01-01", "2026-01-01");
    const role = await infra.runtimeDb.$client.query(
      "select r.rolsuper, r.rolbypassrls, (select count(*) from pg_tables t where t.tablename = 'branch_closure' and t.tableowner = current_user)::int as owns from pg_roles r where r.rolname = current_user",
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: 0 });
    const noContext = await infra.runtimeDb.$client.query("select count(*)::int as n from branch_closure").catch(() => ({ rows: [{ n: 0 }] }));
    expect(noContext.rows[0]).toEqual({ n: 0 });
    const foreign = await withTenant(infra.runtimeDb, other.orgId, (tx) => tx.query.branchClosure.findMany());
    expect(foreign).toEqual([]);
    const own = await withTenant(infra.runtimeDb, s.orgId, (tx) => tx.query.branchClosure.findMany());
    expect(own).toHaveLength(1);
  });

  it("applies the common schedule route errors", async () => {
    await expectScheduleRouteErrors(app, infra, "GET", (s) => `/branches/${s.branchIds[0]}/closures`);
  });
});
