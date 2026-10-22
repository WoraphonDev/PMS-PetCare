import { randomUUID } from "node:crypto";
import { StaffListResponse, StaffMember } from "@app/contracts";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { AUTH, type Auth } from "../../src/modules/identity";
import { EMAIL_SENDER, type FakeEmailSender } from "../../src/modules/notification/email";
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
  insertInvitationRow,
  membershipBranchesOf,
  membershipsOf,
  seedStaffPlan,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-staff-account-create · #rule-managed-account-roles ·
// #rule-managed-account-identity · #rule-staff-check-and-lock · #rule-staff-capacity · F02 · F05 · F07 · F09 · §6
const fail = vi.hoisted(() => ({ audit: false, query: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (fail.audit) throw new Error("forced audit failure");
      return original.writeAudit(...args);
    },
    // A real failing query whose params hold the username (unknown column), so drizzle builds its DrizzleQueryError.
    transactionQuery: (tx: Parameters<typeof original.transactionQuery>[0]) => {
      const query = original.transactionQuery(tx);
      return (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!fail.query || !strings.join("").includes("WHERE username =")) return query(strings, ...values);
        const broken = Object.assign(
          strings.map((s) => s.replace("WHERE username =", "WHERE username_missing =")),
          { raw: strings.raw },
        ) as unknown as TemplateStringsArray;
        return query(broken, ...values);
      };
    },
  };
});

const logs: string[] = [];
let spies: MockInstance[] = [];
let infra: TestInfra;
let app: NestFastifyApplication;
let mail: FakeEmailSender;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
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
  mail.sent.length = 0;
});

const PASSWORD = "first-pass-123";
const create = (headers: Record<string, string>, body: unknown) => call(app, "POST", "/staff/accounts", headers, body);
const freshUsername = () => `m.${randomUUID().slice(0, 8)}`;
const body = (over: Record<string, unknown> = {}) => ({
  displayName: "Mai",
  username: freshUsername(),
  password: PASSWORD,
  role: "groomer",
  branchIds: [] as string[],
  ...over,
});
const captured = () => [...logs, ...spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)))].join("\n");
// Better Auth's scrypt output: hex salt ":" hex key.
const HASH = /[0-9a-f]{32}:[0-9a-f]{64,}/;
const login = (identifier: string, password = PASSWORD) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { identifier, password },
    remoteAddress: `10.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((res.headers["set-cookie"] as string[] | string | undefined) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

/** Owner (or `role`) caller in an org with branches A, B and `maxStaff` seats; the caller is one seat. */
async function shop(role: "owner" | "manager" = "owner", maxStaff: number | null = 5) {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedStaffPlan(infra, s.orgId, maxStaff);
  return s;
}
async function usersNamed(username: string) {
  return infra.platformDb.query.user.findMany({ where: (u, { eq }) => eq(u.username, username) });
}
/** Every row a rejected create could touch: memberships, their branches, audit, and the would-be account. */
async function snapshot(orgId: string, username: string) {
  const { rows: membershipBranches } = await infra.platformDb.$client.query(
    "select membership_id, branch_id from membership_branch where org_id = $1 order by membership_id, branch_id",
    [orgId],
  );
  const memberships = (await membershipsOf(infra, orgId)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const { rows: managed } = await infra.platformDb.$client.query('select id from "user" where managed_by_org_id = $1 order by id', [orgId]);
  return { memberships, membershipBranches, audit: await auditOf(infra, orgId), managed, named: await usersNamed(username) };
}
async function expectRejected(
  s: { orgId: string; headers: Record<string, string> },
  payload: Record<string, unknown>,
  status: number,
  code: string,
) {
  const username = String(payload.username ?? "");
  const before = await snapshot(s.orgId, username);
  const error = await expectError(await create(s.headers, payload), status, code);
  expect(await snapshot(s.orgId, username)).toEqual(before);
  return error;
}

describe("staff.account.create happy path", () => {
  it("creates the managed account, membership, branches and audit in one go and answers 201 StaffMember", async () => {
    const s = await shop();
    const username = freshUsername();
    const res = await create(
      s.headers,
      body({ displayName: "  Mai  ", username: `  ${username.toUpperCase()} `, branchIds: [s.branchIds[1]!] }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const dto = StaffMember.parse(res.json());
    expect(dto).toEqual({
      membershipId: expect.any(String),
      userId: expect.any(String),
      displayName: "Mai",
      email: null,
      username,
      role: "groomer",
      branchIds: [s.branchIds[1]!],
      status: "active",
      isManaged: true,
      twoFactorEnabled: false,
      createdAt: FIXED_NOW.toISOString(),
    });
    const [user] = await usersNamed(username);
    expect(user).toMatchObject({
      id: dto.userId,
      name: "Mai",
      email: `${dto.userId}@managed.invalid`,
      emailVerified: false,
      isManaged: true,
      managedByOrgId: s.orgId,
      mustChangePassword: true,
    });
    const membership = (await membershipsOf(infra, s.orgId)).find((m) => m.id === dto.membershipId);
    expect(membership).toMatchObject({ userId: dto.userId, role: "groomer", displayName: "Mai", status: "active", createdAt: FIXED_NOW });
    expect(await membershipBranchesOf(infra, dto.membershipId)).toEqual([s.branchIds[1]!]);

    const audit = await auditOf(infra, s.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "staff.account_created",
      actorUserId: s.userId,
      entityType: "membership",
      entityId: dto.membershipId,
      before: null,
      after: { username, displayName: "Mai", role: "groomer", branchIds: [s.branchIds[1]!] },
      occurredAt: FIXED_NOW,
    });
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain(PASSWORD);
    expect(auditText).not.toMatch(HASH);
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toMatch(HASH);
    expect(captured()).not.toContain(PASSWORD);
    expect(captured()).not.toMatch(HASH);
    expect(mail.sent).toEqual([]);

    const list = StaffListResponse.parse((await call(app, "GET", "/staff", s.headers)).json());
    expect(list.members.find((m) => m.membershipId === dto.membershipId)).toEqual(dto);
  });

  it("lets an owner create managed owner and manager accounts, and a manager every branch role", async () => {
    const owner = await shop();
    for (const role of ["owner", "manager"] as const) {
      const res = await create(owner.headers, body({ role, branchIds: [] }));
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ role, branchIds: [], isManaged: true });
    }
    const manager = await shop("manager");
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      expect((await create(manager.headers, body({ role, branchIds: [manager.branchIds[0]!] }))).statusCode).toBe(201);
    }
  });

  it("end to end: username login, PASSWORD_CHANGE_REQUIRED on GET /staff with the guard's exceptions intact, then normal access", async () => {
    const s = await shop();
    const username = freshUsername();
    expect((await create(s.headers, body({ username, role: "front_desk", branchIds: [s.branchIds[0]!] }))).statusCode).toBe(201);
    const logged = await login(username.toUpperCase());
    expect(logged.statusCode, logged.body).toBe(200);
    expect(logged.json()).toEqual({ twoFactorRequired: false, mustChangePassword: true });
    const cookie = cookieOf(logged);
    const headers = { cookie, "x-org-id": s.orgId };

    await expectError(await call(app, "GET", "/staff", headers), 403, "PASSWORD_CHANGE_REQUIRED");
    expect((await call(app, "GET", "/me", { cookie })).statusCode).toBe(200);
    const changed = await call(
      app,
      "POST",
      "/auth/password/change",
      { cookie },
      { currentPassword: PASSWORD, newPassword: "second-pass-456" },
    );
    expect(changed.statusCode, changed.body).toBe(204);
    expect((await call(app, "GET", "/staff", headers)).statusCode).toBe(200);
    expect((await login(username, "second-pass-456")).json()).toEqual({ twoFactorRequired: false, mustChangePassword: false });
  });
});

describe("staff.account.create errors in §15 order", () => {
  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "POST", "/staff/accounts", body());
  });

  it("denies roles without staff.invite", async () => {
    const s = await shop();
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const member = await addMember(app, infra, s.orgId, { role, branchIds: [s.branchIds[0]!] });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { identifier: member.email, password: "correct-horse-1" },
      });
      const payload = body({ branchIds: [s.branchIds[0]!] });
      await expectRejected({ orgId: s.orgId, headers: { cookie: cookieOf(res), "x-org-id": s.orgId } }, payload, 403, "FORBIDDEN");
    }
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await shop();
    await suspend(infra, s.orgId);
    await expectRejected(s, body({ branchIds: [s.branchIds[0]!] }), 423, "ORG_SUSPENDED");
  });

  it("rejects invalid bodies at details.fields.<key>", async () => {
    const s = await shop();
    for (const [over, field] of [
      [{ username: "ab" }, "username"],
      [{ username: "mai@shop" }, "username"],
      [{ password: "a".repeat(9) }, "password"],
      [{ password: "a".repeat(129) }, "password"],
      [{ displayName: "   " }, "displayName"],
      [{ role: "admin" }, "role"],
      [{ role: "owner", branchIds: [s.branchIds[0]!] }, "branchIds"],
      [{ branchIds: ["x"] }, "branchIds.0"],
    ] as const) {
      const error = await expectRejected(s, body(over), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(over)).toContain(field);
    }
    await expectUnknownKeysRejected((payload) => create(s.headers, payload), body({ branchIds: [s.branchIds[0]!] }));
  });

  it("forbids a manager from creating owner/manager accounts, before BRANCH_REQUIRED and the plan limit; a bad body still wins", async () => {
    const s = await shop("manager", 1);
    for (const role of ["owner", "manager"] as const) await expectRejected(s, body({ role }), 403, "FORBIDDEN");
    await expectRejected(s, body({ role: "owner", password: "short" }), 400, "VALIDATION_FAILED");
  });

  it("requires a branch for branch roles (BRANCH_REQUIRED), before the branch lookup and the plan limit", async () => {
    const s = await shop("owner", 1);
    for (const role of ["front_desk", "groomer", "caretaker"] as const) await expectRejected(s, body({ role }), 400, "BRANCH_REQUIRED");
  });

  it("answers NOT_FOUND for an unknown branch id and for another organization's branch id alike (F07), before the plan limit", async () => {
    const s = await shop("owner", 1);
    const other = await shop();
    for (const branchIds of [[randomUUID()], [other.branchIds[0]!], [s.branchIds[0]!, other.branchIds[0]!]])
      await expectRejected(s, body({ branchIds }), 404, "NOT_FOUND");
  });

  it("counts the owner, active members, managed accounts and pending invitations against max_staff (PLAN_LIMIT_REACHED before CONFLICT)", async () => {
    const s = await shop("owner", 4);
    await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!], status: "removed" });
    await insertInvitationRow(infra, {
      orgId: s.orgId,
      email: `${randomUUID()}@example.com`,
      role: "owner",
      invitedByUserId: s.userId,
      expiresAt: new Date("2031-05-10T00:00:00Z"),
    });
    await insertInvitationRow(infra, {
      orgId: s.orgId,
      email: `${randomUUID()}@example.com`,
      role: "owner",
      invitedByUserId: s.userId,
      expiresAt: FIXED_NOW,
    });
    const taken = freshUsername();
    expect((await create(s.headers, body({ username: taken, role: "owner" }))).statusCode).toBe(201);
    await expectRejected(s, body({ role: "owner" }), 402, "PLAN_LIMIT_REACHED");
    await expectRejected(s, body({ username: taken, role: "owner" }), 402, "PLAN_LIMIT_REACHED");
  });

  it("treats max_staff null as unlimited", async () => {
    const s = await shop("owner", null);
    for (let i = 0; i < 3; i++) expect((await create(s.headers, body({ role: "owner" }))).statusCode).toBe(201);
  });

  it("answers CONFLICT for a username already used, in any case, by a managed or a real-email account", async () => {
    const s = await shop();
    const managed = freshUsername();
    expect((await create(s.headers, body({ username: managed, role: "owner" }))).statusCode).toBe(201);
    const real = freshUsername();
    await app
      .get<Auth>(AUTH)
      .api.signUpEmail({ body: { email: `${randomUUID()}@example.com`, username: real, password: "correct-horse-1", name: "Real" } });
    for (const username of [managed, managed.toUpperCase(), real, ` ${real.toUpperCase()} `])
      await expectRejected(s, body({ username, role: "owner" }), 409, "CONFLICT");
    expect(await usersNamed(managed)).toHaveLength(1);
  });
});

describe("failures, concurrency and logs", () => {
  it("fails closed with INTERNAL when the organization has no subscription", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await expectRejected(s, body({ role: "owner" }), 500, "INTERNAL");
  });

  it("re-checks the organization status after the subscription lock: suspended while waiting → ORG_SUSPENDED, nothing written", async () => {
    const s = await shop();
    const payload = body({ role: "owner" });
    const before = await snapshot(s.orgId, payload.username);
    const lock = await holdSubscriptionLock(infra, s.orgId);
    const pending = create(s.headers, payload);
    await lock.waiting();
    await suspend(infra, s.orgId);
    await lock.release();
    await expectError(await pending, 423, "ORG_SUSPENDED");
    expect(await snapshot(s.orgId, payload.username)).toEqual(before);
  });

  it("rolls back when the audit write fails: INTERNAL, no user, account, membership or audit row", async () => {
    const s = await shop();
    const payload = body({ branchIds: [s.branchIds[0]!] });
    fail.audit = true;
    try {
      await expectRejected(s, payload, 500, "INTERNAL");
    } finally {
      fail.audit = false;
    }
    const { rows } = await infra.platformDb.$client.query(
      'select count(*)::int as n from account a join "user" u on u.id = a.user_id where u.username = $1',
      [payload.username],
    );
    expect(rows[0]).toEqual({ n: 0 });
    expect(captured()).toContain("unexpected error");
    expect(captured()).not.toContain(payload.username);
    expect(captured()).not.toContain(PASSWORD);
    expect(captured()).not.toMatch(HASH);
  });

  it("a failing query → INTERNAL with the unexpected-error log line, but neither the username, the password nor the hash is logged", async () => {
    const s = await shop();
    const payload = body({ role: "owner" });
    const before = await snapshot(s.orgId, payload.username);
    fail.query = true;
    let res: Awaited<ReturnType<typeof create>>;
    try {
      res = await create(s.headers, payload);
    } finally {
      fail.query = false;
    }
    await expectError(res, 500, "INTERNAL");
    expect(await snapshot(s.orgId, payload.username)).toEqual(before);
    const reqId = res.headers["x-request-id"];
    expect(logs.map((l) => JSON.parse(l) as Record<string, unknown>).some((l) => l.msg === "unexpected error" && l.reqId === reqId)).toBe(
      true,
    );
    expect(captured()).toContain("SQLSTATE 42703");
    expect(captured()).not.toContain(payload.username);
    expect(captured()).not.toContain(PASSWORD);
    expect(captured()).not.toMatch(HASH);
  });

  it("two parallel creates with the same username in one org → one 201, one CONFLICT, one account", async () => {
    const s = await shop();
    const username = freshUsername();
    const results = await Promise.all([1, 2].map(() => create(s.headers, body({ username, role: "owner" }))));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await usersNamed(username)).toHaveLength(1);
    expect((await auditOf(infra, s.orgId)).filter((a) => a.action === "staff.account_created")).toHaveLength(1);
  });

  it("parallel creates of one username in two orgs → one 201, one CONFLICT (a unique violation maps to CONFLICT), one account", async () => {
    const a = await shop();
    const b = await shop();
    const username = freshUsername();
    const results = await Promise.all([a, b].map((s) => create(s.headers, body({ username, role: "owner" }))));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await usersNamed(username)).toHaveLength(1);
    expect(captured()).not.toContain(username);
  });

  it("parallel creates at max_staff − 1 → exactly one 201", async () => {
    const s = await shop("owner", 2);
    const results = await Promise.all(Array.from({ length: 4 }, () => create(s.headers, body({ role: "owner" }))));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 402, 402, 402]);
    expect((await membershipsOf(infra, s.orgId)).filter((m) => m.status === "active")).toHaveLength(2);
  });
});
