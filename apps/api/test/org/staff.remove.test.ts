import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  addMember,
  auditOf,
  call,
  expectError,
  expectGuardErrors,
  expectNoBodyRule,
  FIXED_NOW,
  holdSubscriptionLock,
  loginCookie,
  membershipBranchesOf,
  membershipsOf,
  seedStaffPlan,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-staff-remove · #rule-staff-caller-recheck · #rule-staff-check-and-lock ·
// #rule-staff-capacity · F01 · F07 · F09 · ¹ · §6 staff.removed (T-0017-02)
const fail = vi.hoisted(() => ({ audit: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (fail.audit) throw new Error("forced audit failure");
      return original.writeAudit(...args);
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

type Role = "owner" | "manager" | "front_desk" | "groomer" | "caretaker";
const remove = (headers: Record<string, string>, membershipId: string) => call(app, "DELETE", `/staff/${membershipId}`, headers);
let ip = 0;
const login = (identifier: string, password: string) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { identifier, password },
    remoteAddress: `10.19.${Math.floor(++ip / 250)}.${ip % 250}`,
  });

async function shop(role: "owner" | "manager" = "owner", maxStaff: number | null = null) {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedStaffPlan(infra, s.orgId, maxStaff);
  const self = (await membershipsOf(infra, s.orgId)).find((m) => m.userId === s.userId)!;
  return { ...s, membershipId: self.id };
}
async function member(orgId: string, role: Role, branchIds: string[] = []) {
  const m = await addMember(app, infra, orgId, { role, branchIds });
  const cookie = await loginCookie(app, m.email);
  return { ...m, cookie, headers: { cookie, "x-org-id": orgId } };
}
async function sessionsOf(userId: string) {
  return infra.platformDb.query.session.findMany({ where: (s, { eq }) => eq(s.userId, userId) });
}
async function snapshot(orgId: string, userIds: readonly string[] = []) {
  const { rows: membershipBranches } = await infra.platformDb.$client.query(
    "select membership_id, branch_id from membership_branch where org_id = $1 order by membership_id, branch_id",
    [orgId],
  );
  const { rows: sessions } = await infra.platformDb.$client.query("select id, user_id from session where user_id = any($1) order by id", [
    [...userIds],
  ]);
  const memberships = (await membershipsOf(infra, orgId)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { memberships, membershipBranches, audit: await auditOf(infra, orgId), sessions };
}
async function expectRejected(
  orgId: string,
  send: () => ReturnType<typeof call>,
  status: number,
  code: string,
  userIds: readonly string[] = [],
) {
  const before = await snapshot(orgId, userIds);
  const error = await expectError(await send(), status, code);
  expect(await snapshot(orgId, userIds)).toEqual(before);
  return error;
}
const removals = async (orgId: string) => (await auditOf(infra, orgId)).filter((a) => a.action === "staff.removed");
const activeOwners = async (orgId: string) =>
  (await membershipsOf(infra, orgId)).filter((m) => m.role === "owner" && m.status === "active");

describe("staff.remove happy path", () => {
  it("204: status removed, branch rows kept, audit staff.removed, seat freed", async () => {
    const s = await shop("owner", 2);
    const m = await member(s.orgId, "groomer", [s.branchIds[1]!, s.branchIds[0]!]);
    const email = `${randomUUID()}@example.com`;
    const invite = () => call(app, "POST", "/staff/invitations", s.headers, { email, role: "owner", branchIds: [] });
    await expectError(await invite(), 402, "PLAN_LIMIT_REACHED");

    const res = await remove(s.headers, m.membershipId);
    expect(res.statusCode, res.body).toBe(204);
    expect(res.body).toBe("");
    expect((await membershipsOf(infra, s.orgId)).find((x) => x.id === m.membershipId)).toMatchObject({
      status: "removed",
      role: "groomer",
      updatedAt: FIXED_NOW,
    });
    const branches = [s.branchIds[0]!, s.branchIds[1]!].sort();
    expect(await membershipBranchesOf(infra, m.membershipId)).toEqual(branches);
    const audit = await removals(s.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: s.userId,
      entityType: "membership",
      entityId: m.membershipId,
      before: { status: "active", role: "groomer", branchIds: branches },
      after: { status: "removed" },
      occurredAt: FIXED_NOW,
    });
    expect((await invite()).statusCode).toBe(201);
  });

  it("the removed real-email member is blocked in this shop at once, keeps their sessions and their other shop", async () => {
    const s = await shop();
    const m = await member(s.orgId, "front_desk", [s.branchIds[0]!]);
    const other = await shop();
    await infra.platformDb.$client.query("insert into membership (org_id, user_id, role, display_name) values ($1, $2, 'manager', 'M')", [
      other.orgId,
      m.userId,
    ]);
    const sessions = await sessionsOf(m.userId);
    expect(sessions.length).toBeGreaterThan(0);
    expect((await call(app, "GET", "/staff", m.headers)).statusCode).toBe(200);

    expect((await remove(s.headers, m.membershipId)).statusCode).toBe(204);
    await expectError(await call(app, "GET", "/staff", m.headers), 403, "FORBIDDEN");
    expect((await call(app, "GET", "/staff", { cookie: m.cookie, "x-org-id": other.orgId })).statusCode).toBe(200);
    expect(await sessionsOf(m.userId)).toEqual(sessions);
  });

  it("a managed account of this org loses every session and can no longer log in", async () => {
    const s = await shop();
    const username = `m.${randomUUID().slice(0, 8)}`;
    const created = await call(app, "POST", "/staff/accounts", s.headers, {
      displayName: "Managed",
      username,
      password: "first-pass-123",
      role: "groomer",
      branchIds: [s.branchIds[0]!],
    });
    const { membershipId, userId } = created.json() as { membershipId: string; userId: string };
    const first = await login(username, "first-pass-123");
    expect(first.statusCode).toBe(200);
    expect((await login(username, "first-pass-123")).statusCode).toBe(200);
    expect(await sessionsOf(userId)).toHaveLength(2);

    expect((await remove(s.headers, membershipId)).statusCode).toBe(204);
    expect(await sessionsOf(userId)).toEqual([]);
    await expectError(await login(username, "first-pass-123"), 401, "UNAUTHENTICATED");
  });

  it("lets a manager remove branch roles, and an owner remove another owner or a manager", async () => {
    const s = await shop();
    const mgr = await member(s.orgId, "manager");
    for (const role of ["front_desk", "groomer", "caretaker"] as const)
      expect((await remove(mgr.headers, (await member(s.orgId, role, [s.branchIds[0]!])).membershipId)).statusCode).toBe(204);
    expect((await remove(s.headers, (await member(s.orgId, "owner")).membershipId)).statusCode).toBe(204);
    expect((await remove(s.headers, mgr.membershipId)).statusCode).toBe(204);
  });

  it("lets an owner remove themselves while another owner remains", async () => {
    const s = await shop();
    await member(s.orgId, "owner");
    expect((await remove(s.headers, s.membershipId)).statusCode).toBe(204);
    expect(await activeOwners(s.orgId)).toHaveLength(1);
  });
});

describe("staff.remove errors in §16 order", () => {
  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "DELETE", `/staff/${randomUUID()}`);
  });

  it("denies roles without staff.remove", async () => {
    const s = await shop();
    const target = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const caller = await member(s.orgId, role, [s.branchIds[0]!]);
      await expectRejected(s.orgId, () => remove(caller.headers, target.membershipId), 403, "FORBIDDEN");
    }
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    await suspend(infra, s.orgId);
    await expectRejected(s.orgId, () => remove(s.headers, m.membershipId), 423, "ORG_SUSPENDED");
  });

  it("rejects a malformed id, and any body or query (DELETE rules)", async () => {
    const s = await shop();
    const bad = await expectError(await remove(s.headers, "not-a-uuid"), 400, "VALIDATION_FAILED");
    expect(Object.keys((bad.details as { fields: object }).fields)).toContain("membershipId");
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    const error = await expectError(await call(app, "DELETE", `/staff/${m.membershipId}?force=1`, s.headers), 400, "VALIDATION_FAILED");
    expect(Object.keys((error.details as { fields: object }).fields)).toContain("force");
    await expectNoBodyRule(
      app,
      "DELETE",
      async () => `/staff/${(await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] })).membershipId}`,
      s.headers,
      204,
    );
  });

  it("answers NOT_FOUND for an absent, another org's or an already removed membership", async () => {
    const s = await shop();
    const other = await shop();
    const foreign = await member(other.orgId, "groomer", [other.branchIds[0]!]);
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    expect((await remove(s.headers, m.membershipId)).statusCode).toBe(204);
    for (const id of [randomUUID(), foreign.membershipId, m.membershipId])
      await expectRejected(s.orgId, () => remove(s.headers, id), 404, "NOT_FOUND");
    expect(await removals(other.orgId)).toEqual([]);
  });

  it("forbids a manager on an owner, another manager or its own membership", async () => {
    const s = await shop();
    const mgr = await member(s.orgId, "manager");
    const otherMgr = await member(s.orgId, "manager");
    for (const id of [s.membershipId, otherMgr.membershipId, mgr.membershipId])
      await expectRejected(s.orgId, () => remove(mgr.headers, id), 403, "FORBIDDEN", [mgr.userId]);
  });

  it("refuses to remove the last active owner, also oneself (LAST_OWNER); manager rule first", async () => {
    const s = await shop();
    await addMember(app, infra, s.orgId, { role: "owner", status: "removed" });
    await expectRejected(s.orgId, () => remove(s.headers, s.membershipId), 409, "LAST_OWNER", [s.userId]);
    const mgr = await member(s.orgId, "manager");
    await expectRejected(s.orgId, () => remove(mgr.headers, s.membershipId), 403, "FORBIDDEN");
  });
});

describe("caller re-check, concurrency and atomicity", () => {
  it("fails closed with INTERNAL when the organization has no subscription", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    await expectRejected(s.orgId, () => remove(s.headers, m.membershipId), 500, "INTERNAL");
  });

  it("re-checks the organization status after the subscription lock: suspended while waiting → ORG_SUSPENDED", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    const before = await snapshot(s.orgId, [m.userId]);
    const lock = await holdSubscriptionLock(infra, s.orgId);
    const pending = remove(s.headers, m.membershipId);
    await lock.waiting();
    await suspend(infra, s.orgId);
    await lock.release();
    await expectError(await pending, 423, "ORG_SUSPENDED");
    expect(await snapshot(s.orgId, [m.userId])).toEqual(before);
  });

  it.each([
    ["removed", "update membership set status = 'removed' where id = $1"],
    ["demoted to groomer", "update membership set role = 'groomer' where id = $1"],
    ["demoted to manager (owner target)", "update membership set role = 'manager' where id = $1"],
  ])("caller %s while waiting on the lock → FORBIDDEN, nothing removed, sessions unchanged", async (_, sql) => {
    const s = await shop();
    const owner2 = await member(s.orgId, "owner");
    const target = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    const caller = await member(s.orgId, "owner");
    const targetId = sql.includes("'manager'") ? owner2.membershipId : target.membershipId;
    const lock = await holdSubscriptionLock(infra, s.orgId);
    const pending = remove(caller.headers, targetId);
    await lock.waiting();
    await infra.platformDb.$client.query(sql, [caller.membershipId]);
    const users = [owner2.userId, target.userId, caller.userId];
    const before = await snapshot(s.orgId, users);
    await lock.release();
    await expectError(await pending, 403, "FORBIDDEN");
    expect(await snapshot(s.orgId, users)).toEqual(before);
  });

  it("two owners removing each other in parallel → one 204, one FORBIDDEN (caller re-check), one owner left, one audit row", async () => {
    const s = await shop();
    const b = await member(s.orgId, "owner");
    const results = await Promise.all([remove(s.headers, b.membershipId), remove(b.headers, s.membershipId)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 403]);
    expect(results.find((r) => r.statusCode === 403)!.json().error.code).toBe("FORBIDDEN");
    expect(await activeOwners(s.orgId)).toHaveLength(1);
    expect(await removals(s.orgId)).toHaveLength(1);
  });

  it("two owners each removing themselves in parallel → one 204, one LAST_OWNER, one owner left, one audit row", async () => {
    const s = await shop();
    const b = await member(s.orgId, "owner");
    const results = await Promise.all([remove(s.headers, s.membershipId), remove(b.headers, b.membershipId)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("LAST_OWNER");
    expect(await activeOwners(s.orgId)).toHaveLength(1);
    expect(await removals(s.orgId)).toHaveLength(1);
  });

  it("rolls back when the audit write fails: INTERNAL, membership and a managed account's sessions unchanged", async () => {
    const s = await shop();
    const username = `m.${randomUUID().slice(0, 8)}`;
    const created = await call(app, "POST", "/staff/accounts", s.headers, {
      displayName: "Managed",
      username,
      password: "first-pass-123",
      role: "groomer",
      branchIds: [s.branchIds[0]!],
    });
    const { membershipId, userId } = created.json() as { membershipId: string; userId: string };
    expect((await login(username, "first-pass-123")).statusCode).toBe(200);
    fail.audit = true;
    try {
      await expectRejected(s.orgId, () => remove(s.headers, membershipId), 500, "INTERNAL", [userId]);
    } finally {
      fail.audit = false;
    }
    expect(await sessionsOf(userId)).toHaveLength(1);
  });
});
