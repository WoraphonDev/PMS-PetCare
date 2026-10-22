import { randomUUID } from "node:crypto";
import { membership, withTenant } from "@app/db";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
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
  membershipsOf,
  seedStaffPlan,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-staff-password-reset · #rule-managed-account-roles · F09 · F11 · ¹ · §6
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

const logs: string[] = [];
let spies: MockInstance[] = [];
let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
  spies = [
    ...(["log", "error", "warn", "debug", "verbose"] as const).map((m) => vi.spyOn(Logger.prototype, m)),
    ...(["log", "error", "warn"] as const).map((m) => vi.spyOn(console, m)),
  ];
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});
beforeEach(() => {
  logs.length = 0;
  for (const spy of spies) spy.mockClear();
});

const FIRST = "first-pass-123";
const CHANGED = "changed-pass-456";
const NEW = "reset-pass-789";
const HASH = /[0-9a-f]{32}:[0-9a-f]{64,}/;
const captured = () => [...logs, ...spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)))].join("\n");
let ip = 0;
const login = (identifier: string, password: string) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { identifier, password },
    remoteAddress: `10.17.${Math.floor(++ip / 250)}.${ip % 250}`,
  });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((res.headers["set-cookie"] as string[] | string | undefined) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
const reset = (headers: Record<string, string>, membershipId: string, payload: unknown = { newPassword: NEW }) =>
  call(app, "PUT", `/staff/${membershipId}/password`, headers, payload);

async function shop(role: "owner" | "manager" = "owner") {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedStaffPlan(infra, s.orgId, null);
  return s;
}
/** A managed account made through the API, its password already changed once (FIRST → CHANGED), logged in. */
async function managed(s: { headers: Record<string, string>; branchIds: string[] }, role: "owner" | "manager" | "groomer" = "groomer") {
  const username = `m.${randomUUID().slice(0, 8)}`;
  const res = await call(app, "POST", "/staff/accounts", s.headers, {
    displayName: "Managed",
    username,
    password: FIRST,
    role,
    branchIds: role === "groomer" ? [s.branchIds[0]!] : [],
  });
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.body}`);
  const { membershipId, userId } = res.json() as { membershipId: string; userId: string };
  const cookie = cookieOf(await login(username, FIRST));
  await call(app, "POST", "/auth/password/change", { cookie }, { currentPassword: FIRST, newPassword: CHANGED });
  return { username, membershipId, userId, cookie };
}
async function identity(userId: string) {
  const user = await infra.platformDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
  const accounts = await infra.platformDb.query.account.findMany({ where: (a, { eq }) => eq(a.userId, userId) });
  const sessions = await infra.platformDb.query.session.findMany({ where: (s, { eq }) => eq(s.userId, userId) });
  const twoFactor = await infra.platformDb.query.twoFactor.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
  const { rows: markers } = await infra.platformDb.$client.query(
    "select identifier from verification where value = $1 order by identifier",
    [userId],
  );
  return { user, accounts, sessions, twoFactor, markers };
}
/** Every row a rejected reset could touch: memberships, audit, and the target's identity rows. */
async function snapshot(orgId: string, userId: string) {
  return { memberships: await membershipsOf(infra, orgId), audit: await auditOf(infra, orgId), identity: await identity(userId) };
}
async function expectRejected(
  s: { orgId: string },
  headers: Record<string, string>,
  target: { membershipId: string; userId: string },
  status: number,
  code: string,
  payload?: unknown,
) {
  const before = await snapshot(s.orgId, target.userId);
  const error = await expectError(await reset(headers, target.membershipId, payload), status, code);
  expect(await snapshot(s.orgId, target.userId)).toEqual(before);
  return error;
}
async function memberHeaders(orgId: string, role: "owner" | "manager" | "front_desk" | "groomer" | "caretaker", branchIds: string[]) {
  const member = await addMember(app, infra, orgId, { role, branchIds });
  return { cookie: cookieOf(await login(member.email, "correct-horse-1")), "x-org-id": orgId };
}

describe("staff.password.reset happy path", () => {
  it("sets the new password with must-change, signs the account out everywhere (incl. a 2FA-passed session), keeps 2FA, audits", async () => {
    const s = await shop();
    const m = await managed(s);
    // A second session that passed 2FA: 2FA enrolled + this session's marker.
    const second = cookieOf(await login(m.username, CHANGED));
    await infra.platformDb.$client.query('update "user" set two_factor_enabled = true where id = $1', [m.userId]);
    await infra.platformDb.$client.query("insert into two_factor (secret, backup_codes, user_id) values ('s', 'b', $1)", [m.userId]);
    for (const session of (await identity(m.userId)).sessions) {
      await infra.platformDb.$client.query("insert into verification (identifier, value, expires_at) values ($1, $2, $3)", [
        `2fa-session:${session.id}`,
        m.userId,
        new Date("2040-01-01T00:00:00Z"),
      ]);
    }
    for (const cookie of [m.cookie, second]) expect((await call(app, "GET", "/me", { cookie })).statusCode).toBe(200);
    const before = await identity(m.userId);

    const res = await reset(s.headers, m.membershipId);
    expect(res.statusCode, res.body).toBe(204);
    expect(res.body).toBe("");

    for (const cookie of [m.cookie, second]) await expectError(await call(app, "GET", "/me", { cookie }), 401, "UNAUTHENTICATED");
    const after = await identity(m.userId);
    expect(after.sessions).toEqual([]);
    expect(after.markers).toEqual([]);
    expect(after.user).toMatchObject({ mustChangePassword: true, twoFactorEnabled: true });
    expect(after.twoFactor).toEqual(before.twoFactor);
    expect((await login(m.username, CHANGED)).statusCode).toBe(401);
    const fresh = await login(m.username, NEW);
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json()).toMatchObject({ twoFactorRequired: true });

    const audit = (await auditOf(infra, s.orgId)).filter((a) => a.action === "staff.password_reset");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: s.userId,
      entityType: "membership",
      entityId: m.membershipId,
      before: null,
      after: null,
      occurredAt: FIXED_NOW,
    });
    expect(JSON.stringify(audit)).not.toContain(NEW);
    expect(captured()).not.toContain(NEW);
    expect(captured()).not.toMatch(HASH);
  });

  it("then requires a password change again: PASSWORD_CHANGE_REQUIRED until changed", async () => {
    const s = await shop();
    const m = await managed(s, "groomer");
    expect((await reset(s.headers, m.membershipId)).statusCode).toBe(204);
    const logged = await login(m.username, NEW);
    expect(logged.json()).toEqual({ twoFactorRequired: false, mustChangePassword: true });
    const cookie = cookieOf(logged);
    await expectError(await call(app, "GET", "/branches", { cookie, "x-org-id": s.orgId }), 403, "PASSWORD_CHANGE_REQUIRED");
  });

  it("lets a manager reset a branch-role managed account", async () => {
    const owner = await shop();
    const managerHeaders = await memberHeaders(owner.orgId, "manager", []);
    expect((await reset(managerHeaders, (await managed(owner, "groomer")).membershipId)).statusCode).toBe(204);
  });

  it.each(["owner", "manager"] as const)("lets an owner reset a managed %s", async (role) => {
    const owner = await shop();
    expect((await reset(owner.headers, (await managed(owner, role)).membershipId)).statusCode).toBe(204);
  });

  it("lets a managed owner reset their own membership (no special case)", async () => {
    const owner = await shop();
    const self = await managed(owner, "owner");
    const selfCookie = cookieOf(await login(self.username, CHANGED));
    expect((await reset({ cookie: selfCookie, "x-org-id": owner.orgId }, self.membershipId)).statusCode).toBe(204);
  });
});

describe("staff.password.reset errors in §15 order", () => {
  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "PUT", `/staff/${randomUUID()}/password`, { newPassword: NEW });
  });

  it("denies roles without staff.update", async () => {
    const s = await shop();
    const m = await managed(s);
    for (const role of ["front_desk", "groomer", "caretaker"] as const)
      await expectRejected(s, await memberHeaders(s.orgId, role, [s.branchIds[0]!]), m, 403, "FORBIDDEN");
  });

  it("rejects a malformed id and invalid bodies with VALIDATION_FAILED", async () => {
    const s = await shop();
    const m = await managed(s);
    const error = await expectError(await reset(s.headers, "not-a-uuid"), 400, "VALIDATION_FAILED");
    expect(Object.keys((error.details as { fields: object }).fields)).toContain("membershipId");
    for (const [payload, field] of [
      [{ newPassword: "a".repeat(9) }, "newPassword"],
      [{ newPassword: "a".repeat(129) }, "newPassword"],
      [{}, "newPassword"],
    ] as const) {
      const e = await expectRejected(s, s.headers, m, 400, "VALIDATION_FAILED", payload);
      expect(Object.keys((e.details as { fields: object }).fields)).toContain(field);
    }
    await expectUnknownKeysRejected((payload) => reset(s.headers, m.membershipId, payload), { newPassword: NEW });
  });

  it("answers NOT_FOUND for an absent, another org's or a removed membership", async () => {
    const s = await shop();
    const other = await shop();
    const foreign = await managed(other);
    const removed = await managed(s);
    await infra.platformDb.$client.query("update membership set status = 'removed' where id = $1", [removed.membershipId]);
    await expectError(await reset(s.headers, randomUUID()), 404, "NOT_FOUND");
    await expectRejected(other, s.headers, foreign, 404, "NOT_FOUND");
    await expectRejected(s, s.headers, removed, 404, "NOT_FOUND");
  });

  it("answers ORG_SUSPENDED for a suspended organization", async () => {
    const s = await shop();
    const m = await managed(s);
    await suspend(infra, s.orgId);
    await expectRejected(s, s.headers, m, 423, "ORG_SUSPENDED");
  });

  it("forbids a manager on an owner/manager target before MANAGED_ACCOUNT_ONLY (no leak whether the target is managed)", async () => {
    const s = await shop();
    const managerHeaders = await memberHeaders(s.orgId, "manager", []);
    for (const role of ["owner", "manager"] as const) await expectRejected(s, managerHeaders, await managed(s, role), 403, "FORBIDDEN");
    const realManager = await addMember(app, infra, s.orgId, { role: "manager" });
    await expectRejected(s, managerHeaders, realManager, 403, "FORBIDDEN");
    const ownerRow = (await membershipsOf(infra, s.orgId)).find((m) => m.userId === s.userId)!;
    await expectRejected(s, managerHeaders, { membershipId: ownerRow.id, userId: s.userId }, 403, "FORBIDDEN");
  });

  it("answers MANAGED_ACCOUNT_ONLY for a real-email account and for another org's managed account that is a member here", async () => {
    const s = await shop();
    const real = await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    await expectRejected(s, s.headers, real, 409, "MANAGED_ACCOUNT_ONLY");
    const ownerRow = (await membershipsOf(infra, s.orgId)).find((m) => m.userId === s.userId)!;
    await expectRejected(s, s.headers, { membershipId: ownerRow.id, userId: s.userId }, 409, "MANAGED_ACCOUNT_ONLY");

    const home = await shop();
    const visitor = await managed(home);
    const membershipId = await withTenant(infra.runtimeDb, s.orgId, async (tx) => {
      const [row] = await tx
        .insert(membership)
        .values({ orgId: s.orgId, userId: visitor.userId, role: "manager", displayName: "Visitor" })
        .returning();
      return row!.id;
    });
    await expectRejected(s, s.headers, { membershipId, userId: visitor.userId }, 409, "MANAGED_ACCOUNT_ONLY");
  });
});

describe("atomicity and logs", () => {
  it("rolls back when the audit write fails: INTERNAL, password, flag and sessions unchanged; nothing logged", async () => {
    const s = await shop();
    const m = await managed(s);
    fail.audit = true;
    try {
      await expectRejected(s, s.headers, m, 500, "INTERNAL");
    } finally {
      fail.audit = false;
    }
    expect((await call(app, "GET", "/me", { cookie: m.cookie })).statusCode).toBe(200);
    expect((await login(m.username, CHANGED)).statusCode).toBe(200);
    expect(captured()).toContain("unexpected error");
    expect(captured()).not.toContain(NEW);
    expect(captured()).not.toMatch(HASH);
  });
});
