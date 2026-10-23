import { randomUUID } from "node:crypto";
import { MeResponse, StaffListResponse, StaffMember } from "@app/contracts";
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
  expectUnknownKeysRejected,
  FIXED_NOW,
  holdSubscriptionLock,
  loginCookie,
  membershipBranchesOf,
  membershipsOf,
  seedStaffPlan,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-staff-update · #rule-staff-caller-recheck · #rule-staff-check-and-lock ·
// #rule-managed-account-roles · F01 · F02 · F07 · ¹ · §6 staff.role_changed (T-0017-03) · T-0017-04
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
const patch = (headers: Record<string, string>, membershipId: string, body: unknown) =>
  call(app, "PATCH", `/staff/${membershipId}`, headers, body);

/** Owner (or `role`) caller in an org with branches A, B, C and unlimited seats. */
async function shop(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B", "C"] });
  await seedStaffPlan(infra, s.orgId, null);
  const self = (await membershipsOf(infra, s.orgId)).find((m) => m.userId === s.userId)!;
  return { ...s, membershipId: self.id };
}
/** A real-email member with a logged-in session. */
async function member(orgId: string, role: Role, branchIds: string[] = [], displayName = "Member") {
  const m = await addMember(app, infra, orgId, { role, branchIds, displayName });
  const cookie = await loginCookie(app, m.email);
  return { ...m, cookie, headers: { cookie, "x-org-id": orgId } };
}
async function rowOf(orgId: string, membershipId: string) {
  return (await membershipsOf(infra, orgId)).find((m) => m.id === membershipId)!;
}
/** Every row a rejected update could touch: memberships, their branches, audit and the sessions of `userIds`. */
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
const changes = async (orgId: string) => (await auditOf(infra, orgId)).filter((a) => a.action === "staff.role_changed");

describe("staff.update happy paths", () => {
  it("changes a branch role to another branch role with new branches: 200 StaffMember, audit of changed fields, GET /staff agrees", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!], "Mai");
    const res = await patch(s.headers, m.membershipId, { role: "caretaker", branchIds: [s.branchIds[2]!, s.branchIds[1]!] });
    expect(res.statusCode, res.body).toBe(200);
    const sorted = [s.branchIds[1]!, s.branchIds[2]!].sort();
    expect(StaffMember.parse(res.json())).toEqual({
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: "Mai",
      email: m.email,
      username: null,
      role: "caretaker",
      branchIds: sorted,
      status: "active",
      isManaged: false,
      twoFactorEnabled: false,
      createdAt: expect.any(String),
    });
    expect(await rowOf(s.orgId, m.membershipId)).toMatchObject({ role: "caretaker", displayName: "Mai", updatedAt: FIXED_NOW });
    expect(await membershipBranchesOf(infra, m.membershipId)).toEqual(sorted);
    const audit = await changes(s.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: s.userId,
      entityType: "membership",
      entityId: m.membershipId,
      before: { role: "groomer", branchIds: [s.branchIds[0]!] },
      after: { role: "caretaker", branchIds: sorted },
      occurredAt: FIXED_NOW,
    });
    const list = StaffListResponse.parse((await call(app, "GET", "/staff", s.headers)).json());
    expect(list.members.find((x) => x.membershipId === m.membershipId)).toEqual(res.json());
  });

  it("branch role → manager without branchIds clears the branches", async () => {
    const s = await shop();
    const m = await member(s.orgId, "front_desk", [s.branchIds[0]!, s.branchIds[1]!]);
    const res = await patch(s.headers, m.membershipId, { role: "manager" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ role: "manager", branchIds: [] });
    expect(await membershipBranchesOf(infra, m.membershipId)).toEqual([]);
    const before = [s.branchIds[0]!, s.branchIds[1]!].sort();
    expect((await changes(s.orgId))[0]).toMatchObject({
      before: { role: "front_desk", branchIds: before },
      after: { role: "manager", branchIds: [] },
    });
  });

  it("manager → branch role requires branches (BRANCH_REQUIRED without), and works with them", async () => {
    const s = await shop();
    const m = await member(s.orgId, "manager");
    await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { role: "groomer" }), 400, "BRANCH_REQUIRED");
    await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { role: "groomer", branchIds: [] }), 400, "BRANCH_REQUIRED");
    const res = await patch(s.headers, m.membershipId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ role: "groomer", branchIds: [s.branchIds[0]!] });
  });

  it("display name only: membership only (user.name untouched), audit has only displayName", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!], "Old");
    const res = await patch(s.headers, m.membershipId, { displayName: "  New  " });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ displayName: "New", role: "groomer", branchIds: [s.branchIds[0]!] });
    const user = await infra.platformDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, m.userId) });
    expect(user!.name).toBe("Old");
    expect((await changes(s.orgId))[0]).toMatchObject({ before: { displayName: "Old" }, after: { displayName: "New" } });
    expect(Object.keys((await changes(s.orgId))[0]!.before as object)).toEqual(["displayName"]);
  });

  it("branches only: the role stays; the member's next request sees the new scope (F02)", async () => {
    const s = await shop();
    const m = await member(s.orgId, "front_desk", [s.branchIds[0]!]);
    const res = await patch(s.headers, m.membershipId, { branchIds: [s.branchIds[1]!] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ role: "front_desk", branchIds: [s.branchIds[1]!] });
    const audit = (await changes(s.orgId))[0]!;
    expect(audit.before).toEqual({ branchIds: [s.branchIds[0]!] });
    expect(audit.after).toEqual({ branchIds: [s.branchIds[1]!] });
    const me = MeResponse.parse((await call(app, "GET", "/me", { cookie: m.cookie })).json());
    expect(me.memberships.find((x) => x.org.id === s.orgId)!.branches.map((b) => b.id)).toEqual([s.branchIds[1]!]);
    const staff = StaffListResponse.parse((await call(app, "GET", "/staff", m.headers)).json());
    expect(staff.members.find((x) => x.membershipId === m.membershipId)!.branchIds).toEqual([s.branchIds[1]!]);
  });

  it("a no-op (every value equal, incl. [] for an owner/manager) → 200 and nothing written", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!], "Same");
    const mgr = await member(s.orgId, "manager", [], "Boss");
    for (const [id, body] of [
      [m.membershipId, { role: "groomer", branchIds: [s.branchIds[0]!.toUpperCase()], displayName: " Same " }],
      [m.membershipId, { branchIds: [s.branchIds[0]!] }],
      [mgr.membershipId, { role: "manager", branchIds: [] }],
      [mgr.membershipId, { branchIds: [] }],
    ] as const) {
      const before = await snapshot(s.orgId);
      const res = await patch(s.headers, id, body);
      expect(res.statusCode, res.body).toBe(200);
      expect(await snapshot(s.orgId)).toEqual(before);
    }
  });

  it("lets an owner promote a managed account to owner or manager (#rule-managed-account-roles), and demote one of two owners", async () => {
    const s = await shop();
    const created = await call(app, "POST", "/staff/accounts", s.headers, {
      displayName: "Managed",
      username: `m.${randomUUID().slice(0, 8)}`,
      password: "first-pass-123",
      role: "groomer",
      branchIds: [s.branchIds[0]!],
    });
    const managedId = (created.json() as { membershipId: string }).membershipId;
    for (const role of ["manager", "owner"] as const) {
      const res = await patch(s.headers, managedId, { role });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ role, isManaged: true, branchIds: [] });
    }
    expect((await patch(s.headers, s.membershipId, { role: "manager" })).statusCode).toBe(200);
    expect((await membershipsOf(infra, s.orgId)).filter((m) => m.role === "owner" && m.status === "active")).toHaveLength(1);
  });
});

describe("staff.update errors in §16 order", () => {
  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "PATCH", `/staff/${randomUUID()}`, { displayName: "X" });
  });

  it("denies roles without staff.update", async () => {
    const s = await shop();
    const target = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const caller = await member(s.orgId, role, [s.branchIds[0]!]);
      await expectRejected(s.orgId, () => patch(caller.headers, target.membershipId, { displayName: "X" }), 403, "FORBIDDEN");
    }
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    await suspend(infra, s.orgId);
    await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { displayName: "X" }), 423, "ORG_SUSPENDED");
  });

  it("rejects a malformed id and invalid bodies with VALIDATION_FAILED", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    const bad = await expectError(await patch(s.headers, "not-a-uuid", { displayName: "X" }), 400, "VALIDATION_FAILED");
    expect(Object.keys((bad.details as { fields: object }).fields)).toContain("membershipId");
    for (const [body, field] of [
      [{}, "_"],
      [{ role: "owner", branchIds: [s.branchIds[0]!] }, "branchIds"],
      [{ branchIds: ["x"] }, "branchIds.0"],
      [{ displayName: "" }, "displayName"],
      [{ role: "admin" }, "role"],
    ] as const) {
      const error = await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, body), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(body)).toContain(field);
    }
    await expectUnknownKeysRejected((body) => patch(s.headers, m.membershipId, body), { displayName: "X" });
  });

  it("answers NOT_FOUND for an absent, another org's or a removed membership", async () => {
    const s = await shop();
    const other = await shop();
    const foreign = await member(other.orgId, "groomer", [other.branchIds[0]!]);
    const removed = await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!], status: "removed" });
    for (const id of [randomUUID(), foreign.membershipId, removed.membershipId])
      await expectRejected(s.orgId, () => patch(s.headers, id, { displayName: "X" }), 404, "NOT_FOUND");
    expect(await snapshot(other.orgId)).toMatchObject({ audit: [] });
  });

  it("forbids a manager on an owner/manager target, promoting to owner/manager, and its own membership", async () => {
    const s = await shop();
    const mgr = await member(s.orgId, "manager");
    const otherMgr = await member(s.orgId, "manager");
    const groomer = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    for (const [id, body] of [
      [s.membershipId, { displayName: "X" }],
      [otherMgr.membershipId, { displayName: "X" }],
      [mgr.membershipId, { displayName: "X" }],
      [groomer.membershipId, { role: "manager" }],
      [groomer.membershipId, { role: "owner" }],
    ] as const)
      await expectRejected(s.orgId, () => patch(mgr.headers, id, body), 403, "FORBIDDEN");
    // The manager rule comes before BRANCH_REQUIRED, branch NOT_FOUND and the T-0017-04 rule.
    await expectRejected(s.orgId, () => patch(mgr.headers, otherMgr.membershipId, { role: "groomer" }), 403, "FORBIDDEN");
    await expectRejected(s.orgId, () => patch(mgr.headers, otherMgr.membershipId, { branchIds: [s.branchIds[0]!] }), 403, "FORBIDDEN");
    // A manager may still change a branch role.
    expect((await patch(mgr.headers, groomer.membershipId, { role: "caretaker" })).statusCode).toBe(200);
  });

  it("T-0017-04: branches for an owner/manager target without role → VALIDATION_FAILED at branchIds, before branch NOT_FOUND", async () => {
    const s = await shop();
    const mgr = await member(s.orgId, "manager");
    for (const id of [mgr.membershipId, s.membershipId]) {
      for (const branchIds of [[s.branchIds[0]!], [randomUUID()]]) {
        const error = await expectRejected(s.orgId, () => patch(s.headers, id, { branchIds }), 400, "VALIDATION_FAILED");
        expect(Object.keys((error.details as { fields: object }).fields)).toEqual(["branchIds"]);
      }
    }
  });

  it("requires branches for a branch role (BRANCH_REQUIRED) before branch NOT_FOUND", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { branchIds: [] }), 400, "BRANCH_REQUIRED");
    await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { role: "caretaker", branchIds: [] }), 400, "BRANCH_REQUIRED");
  });

  it("answers NOT_FOUND for an unknown or another org's branch id (F07), before LAST_OWNER", async () => {
    const s = await shop();
    const other = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    for (const branchIds of [[randomUUID()], [other.branchIds[0]!], [s.branchIds[0]!, other.branchIds[0]!]])
      await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { branchIds }), 404, "NOT_FOUND");
    await expectRejected(s.orgId, () => patch(s.headers, s.membershipId, { role: "groomer", branchIds: [randomUUID()] }), 404, "NOT_FOUND");
  });

  it("refuses to demote the last active owner, also oneself (LAST_OWNER); a removed second owner does not count", async () => {
    const s = await shop();
    await addMember(app, infra, s.orgId, { role: "owner", status: "removed" });
    for (const body of [{ role: "manager" }, { role: "groomer", branchIds: [s.branchIds[0]!] }])
      await expectRejected(s.orgId, () => patch(s.headers, s.membershipId, body), 409, "LAST_OWNER");
    // Changing only the last owner's name is fine.
    expect((await patch(s.headers, s.membershipId, { displayName: "Boss" })).statusCode).toBe(200);
  });

  it("combined: a manager demoting the last owner to a branch role with no branches gets FORBIDDEN (step 4 first)", async () => {
    const s = await shop();
    const mgr = await member(s.orgId, "manager");
    await expectRejected(s.orgId, () => patch(mgr.headers, s.membershipId, { role: "groomer", branchIds: [] }), 403, "FORBIDDEN");
  });
});

describe("caller re-check, concurrency and atomicity", () => {
  it("fails closed with INTERNAL when the organization has no subscription", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    await expectRejected(s.orgId, () => patch(s.headers, m.membershipId, { displayName: "X" }), 500, "INTERNAL");
  });

  it("re-checks the organization status after the subscription lock: suspended while waiting → ORG_SUSPENDED", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    const before = await snapshot(s.orgId, [m.userId]);
    const lock = await holdSubscriptionLock(infra, s.orgId);
    const pending = patch(s.headers, m.membershipId, { displayName: "X" });
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
  ])("caller %s while waiting on the lock → FORBIDDEN, nothing changed", async (_, sql) => {
    const s = await shop();
    const owner2 = await member(s.orgId, "owner");
    const target = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    const caller = await member(s.orgId, "owner");
    // Case (c) needs an owner/manager target; the others use a branch-role target the caller could otherwise change.
    const targetId = sql.includes("'manager'") ? owner2.membershipId : target.membershipId;
    const lock = await holdSubscriptionLock(infra, s.orgId);
    const pending = patch(caller.headers, targetId, { displayName: "Changed" });
    await lock.waiting();
    await infra.platformDb.$client.query(sql, [caller.membershipId]);
    const before = await snapshot(s.orgId, [owner2.userId, target.userId, caller.userId]);
    await lock.release();
    await expectError(await pending, 403, "FORBIDDEN");
    expect(await snapshot(s.orgId, [owner2.userId, target.userId, caller.userId])).toEqual(before);
  });

  it("two owners demoting each other in parallel → one 200, one FORBIDDEN (caller re-check), one owner left, one audit row", async () => {
    const s = await shop();
    const b = await member(s.orgId, "owner");
    const results = await Promise.all([
      patch(s.headers, b.membershipId, { role: "manager" }),
      patch(b.headers, s.membershipId, { role: "manager" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.statusCode === 403)!.json().error.code).toBe("FORBIDDEN");
    expect((await membershipsOf(infra, s.orgId)).filter((m) => m.role === "owner" && m.status === "active")).toHaveLength(1);
    expect(await changes(s.orgId)).toHaveLength(1);
  });

  it("two owners each demoting themselves in parallel → one 200, one LAST_OWNER, one owner left, one audit row", async () => {
    const s = await shop();
    const b = await member(s.orgId, "owner");
    const results = await Promise.all([
      patch(s.headers, s.membershipId, { role: "manager" }),
      patch(b.headers, b.membershipId, { role: "manager" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("LAST_OWNER");
    expect((await membershipsOf(infra, s.orgId)).filter((m) => m.role === "owner" && m.status === "active")).toHaveLength(1);
    expect(await changes(s.orgId)).toHaveLength(1);
  });

  it("rolls back when the audit write fails: INTERNAL, role, name and branches unchanged", async () => {
    const s = await shop();
    const m = await member(s.orgId, "groomer", [s.branchIds[0]!]);
    fail.audit = true;
    try {
      await expectRejected(
        s.orgId,
        () => patch(s.headers, m.membershipId, { role: "caretaker", branchIds: [s.branchIds[1]!], displayName: "X" }),
        500,
        "INTERNAL",
        [m.userId],
      );
    } finally {
      fail.audit = false;
    }
  });
});
