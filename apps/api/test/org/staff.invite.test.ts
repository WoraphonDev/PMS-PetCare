import { createHash, randomUUID } from "node:crypto";
import { Invitation } from "@app/contracts";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import type { BackgroundWork } from "../../src/modules/identity";
import { EMAIL_SENDER, type FakeEmailSender } from "../../src/modules/notification/email";
import { INVITATION_MAIL_BACKGROUND } from "../../src/modules/org/invitation-email";
import { bootTestApp, testConfig } from "../support/app";
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
  invitationsOf,
  membershipsOf,
  outboxOf,
  seedStaffPlan,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-staff-invite · #rule-staff-check-and-lock · #rule-staff-capacity ·
// #rule-invitation-token · F02 · F03 · F05 · F07 · ¹ (manager limits) · §6 staff.invited
const fail = vi.hoisted(() => ({ audit: false, query: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (fail.audit) throw new Error("forced audit failure");
      return original.writeAudit(...args);
    },
    // A real failing query whose params hold the email (unknown column), so drizzle builds its DrizzleQueryError.
    transactionQuery: (tx: Parameters<typeof original.transactionQuery>[0]) => {
      const query = original.transactionQuery(tx);
      return (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!fail.query || !strings.join("").includes("WHERE email =")) return query(strings, ...values);
        const broken = Object.assign(
          strings.map((s) => s.replace("WHERE email =", "WHERE email_missing =")),
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
let background: BackgroundWork;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
  background = app.get<BackgroundWork>(INVITATION_MAIL_BACKGROUND);
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
  mail.failWith = null;
});

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const EXPIRES = new Date(FIXED_NOW.getTime() + SEVEN_DAYS).toISOString();
const invite = async (headers: Record<string, string>, body: unknown) => {
  const res = await call(app, "POST", "/staff/invitations", headers, body);
  await background.idle();
  return res;
};
const freshEmail = () => `${randomUUID()}@example.com`;
const captured = () => [...logs, ...spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)))].join("\n");
const tokenOf = (text: string) => /\/invite#token=([^\s]+)/.exec(text)?.[1];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Owner (or `role`) caller in an org with branches A, B and `maxStaff` seats; the caller is one seat. */
async function shop(role: "owner" | "manager" = "owner", maxStaff: number | null = 5) {
  const s = await seedOrg(app, infra, { role, branches: ["A", "B"] });
  await seedStaffPlan(infra, s.orgId, maxStaff);
  return s;
}
/** Every row a rejected invite could touch: invitations (full contents), memberships, their branches and audit. */
async function snapshot(orgId: string) {
  const { rows: membershipBranches } = await infra.platformDb.$client.query(
    "select membership_id, branch_id from membership_branch where org_id = $1 order by membership_id, branch_id",
    [orgId],
  );
  const memberships = (await membershipsOf(infra, orgId)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { invitations: await invitationsOf(infra, orgId), memberships, membershipBranches, audit: await auditOf(infra, orgId) };
}
async function expectNothingWritten(orgId: string, before: Awaited<ReturnType<typeof snapshot>>) {
  expect(await snapshot(orgId)).toEqual(before);
  expect(mail.sent).toEqual([]);
}

describe("staff.invite happy path", () => {
  it("stores only the hash, audits staff.invited, emails the fragment link with the §14 text and answers 201 without the token", async () => {
    const s = await shop();
    const email = freshEmail();
    const res = await invite(s.headers, { email: `  ${email.toUpperCase()} `, role: "groomer", branchIds: [s.branchIds[0]!] });
    expect(res.statusCode, res.body).toBe(201);
    const dto = Invitation.parse(res.json());
    expect(dto).toEqual({
      id: expect.any(String),
      email,
      role: "groomer",
      branchIds: [s.branchIds[0]!],
      expiresAt: EXPIRES,
      invitedByUserId: s.userId,
      createdAt: FIXED_NOW.toISOString(),
    });
    const [row] = await invitationsOf(infra, s.orgId);
    expect(row).toMatchObject({ id: dto.id, email, role: "groomer", acceptedAt: null, revokedAt: null, expiresAt: new Date(EXPIRES) });
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(mail.sent).toHaveLength(1);
    const message = mail.sent[0]!;
    const token = tokenOf(message.text)!;
    expect(token).toMatch(new RegExp(`^${s.orgId}\\.[A-Za-z0-9_-]{43}$`));
    expect(sha256(token)).toBe(row!.tokenHash);
    expect(message).toEqual({
      to: email,
      subject: "คำเชิญเข้าร่วมร้าน Test shop",
      text:
        "คุณได้รับคำเชิญให้เข้าร่วมร้าน Test shop ในตำแหน่ง ช่างตัดขน\n" +
        "เปิดลิงก์นี้เพื่อรับคำเชิญ (ใช้ได้ครั้งเดียวและหมดอายุใน 7 วัน):\n" +
        `${testConfig.APP_ORIGIN}/invite#token=${token}\n\n` +
        "ถ้าคุณไม่ได้คาดว่าจะได้รับคำเชิญนี้ ไม่ต้องทำอะไร",
    });

    const audit = await auditOf(infra, s.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "staff.invited",
      actorUserId: s.userId,
      entityType: "invitation",
      entityId: dto.id,
      before: null,
      after: { email, role: "groomer", branchIds: [s.branchIds[0]!], expiresAt: EXPIRES },
      occurredAt: FIXED_NOW,
    });
    expect(JSON.stringify([res.json(), audit, captured()])).not.toContain(token);
    expect(res.body).not.toContain(row!.tokenHash);
    expect(await outboxOf(infra, s.orgId)).toEqual([]);
  });

  it("lets an owner invite owner/manager and a manager invite every branch role", async () => {
    const owner = await shop();
    for (const role of ["owner", "manager"] as const) {
      expect((await invite(owner.headers, { email: freshEmail(), role, branchIds: [] })).statusCode).toBe(201);
    }
    const manager = await shop("manager");
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      expect((await invite(manager.headers, { email: freshEmail(), role, branchIds: manager.branchIds })).statusCode).toBe(201);
    }
  });

  it("allows inactive branches, a removed former member and an email with no account", async () => {
    const s = await shop();
    await infra.platformDb.$client.query("update branch set is_active = false where id = $1", [s.branchIds[1]!]);
    const removed = await addMember(app, infra, s.orgId, { role: "groomer", status: "removed" });
    expect((await invite(s.headers, { email: removed.email, role: "caretaker", branchIds: [s.branchIds[1]!] })).statusCode).toBe(201);
    expect((await invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] })).statusCode).toBe(201);
  });
});

describe("re-invite (F03)", () => {
  it("revokes the unexpired invitation of the same email and issues a new one with a new token", async () => {
    const s = await shop();
    const email = freshEmail();
    const first = (await invite(s.headers, { email, role: "groomer", branchIds: [s.branchIds[0]!] })).json();
    const firstToken = tokenOf(mail.sent[0]!.text)!;
    const second = await invite(s.headers, { email: email.toUpperCase(), role: "caretaker", branchIds: [s.branchIds[1]!] });
    expect(second.statusCode).toBe(201);
    const rows = await invitationsOf(infra, s.orgId);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === first.id)!;
    const fresh = rows.find((r) => r.id === second.json().id)!;
    expect(old).toMatchObject({ revokedAt: FIXED_NOW, updatedAt: FIXED_NOW, acceptedAt: null });
    expect(fresh).toMatchObject({ revokedAt: null, role: "caretaker" });
    expect(fresh.tokenHash).not.toBe(old.tokenHash);
    expect(sha256(firstToken)).toBe(old.tokenHash);
    expect(sha256(tokenOf(mail.sent[1]!.text)!)).toBe(fresh.tokenHash);
    expect((await auditOf(infra, s.orgId)).map((a) => a.entityId)).toEqual([first.id, fresh.id]);
  });

  it("does not touch an expired invitation of the same email", async () => {
    const s = await shop();
    const email = freshEmail();
    const expired = await insertInvitationRow(infra, {
      orgId: s.orgId,
      email,
      role: "groomer",
      invitedByUserId: s.userId,
      expiresAt: FIXED_NOW,
    });
    expect((await invite(s.headers, { email, role: "groomer", branchIds: [s.branchIds[0]!] })).statusCode).toBe(201);
    expect((await invitationsOf(infra, s.orgId)).find((r) => r.id === expired)).toMatchObject({ revokedAt: null });
  });

  it("forbids a manager whose re-invite would revoke a pending owner/manager invitation, and changes nothing", async () => {
    const s = await shop("manager");
    const emails = [freshEmail(), freshEmail()];
    for (const [i, role] of (["owner", "manager"] as const).entries()) {
      await insertInvitationRow(infra, {
        orgId: s.orgId,
        email: emails[i]!,
        role,
        invitedByUserId: s.userId,
        expiresAt: new Date(EXPIRES),
      });
    }
    const before = await snapshot(s.orgId);
    for (const email of emails) {
      await expectError(await invite(s.headers, { email, role: "front_desk", branchIds: [s.branchIds[0]!] }), 403, "FORBIDDEN");
    }
    await expectNothingWritten(s.orgId, before);
    const branchRole = freshEmail();
    await insertInvitationRow(infra, {
      orgId: s.orgId,
      email: branchRole,
      role: "groomer",
      invitedByUserId: s.userId,
      expiresAt: new Date(EXPIRES),
    });
    expect((await invite(s.headers, { email: branchRole, role: "front_desk", branchIds: [s.branchIds[0]!] })).statusCode).toBe(201);
  });
});

describe("staff.invite errors in §14 order", () => {
  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "POST", "/staff/invitations", { email: freshEmail(), role: "owner", branchIds: [] });
  });

  it("denies front_desk, groomer and caretaker", async () => {
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await seedStaffPlan(infra, s.orgId, 5);
      const before = await snapshot(s.orgId);
      await expectError(await invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: s.branchIds }), 403, "FORBIDDEN");
      await expectNothingWritten(s.orgId, before);
    }
  });

  it("returns ORG_SUSPENDED for a suspended organization", async () => {
    const s = await shop();
    await suspend(infra, s.orgId);
    const before = await snapshot(s.orgId);
    await expectError(
      await invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] }),
      423,
      "ORG_SUSPENDED",
    );
    await expectNothingWritten(s.orgId, before);
  });

  it("re-checks the organization status after the locks: suspended while waiting → ORG_SUSPENDED, nothing written", async () => {
    const s = await shop();
    const before = await snapshot(s.orgId);
    const lock = await holdSubscriptionLock(infra, s.orgId);
    const pending = invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] });
    try {
      await lock.waiting();
      await suspend(infra, s.orgId);
    } finally {
      await lock.release();
    }
    await expectError(await pending, 423, "ORG_SUSPENDED");
    await expectNothingWritten(s.orgId, before);
  });

  it("rejects invalid bodies at details.fields.<key>", async () => {
    const s = await shop();
    const ok = { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] };
    const before = await snapshot(s.orgId);
    for (const [body, field] of [
      [{ ...ok, email: "nope" }, "email"],
      [{ ...ok, email: `${randomUUID()}@managed.invalid` }, "email"],
      [{ ...ok, role: "admin" }, "role"],
      [{ ...ok, branchIds: ["not-a-uuid"] }, "branchIds.0"],
      [{ ...ok, branchIds: [s.branchIds[0]!, s.branchIds[0]!] }, "branchIds"],
      [{ ...ok, role: "owner" }, "branchIds"],
      [{ email: ok.email, role: "groomer" }, "branchIds"],
      [{ ...ok, orgId: s.orgId }, "orgId"],
    ] as const) {
      const error = await expectError(await invite(s.headers, body), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(body)).toContain(field);
    }
    await expectUnknownKeysRejected((body) => invite(s.headers, body), ok);
    await expectNothingWritten(s.orgId, before);
  });

  it("forbids a manager from inviting owner/manager (before BRANCH_REQUIRED and the plan limit); a bad body still wins", async () => {
    const s = await shop("manager", 1);
    const before = await snapshot(s.orgId);
    for (const role of ["owner", "manager"] as const) {
      await expectError(await invite(s.headers, { email: freshEmail(), role, branchIds: [] }), 403, "FORBIDDEN");
    }
    await expectError(await invite(s.headers, { email: "bad", role: "owner", branchIds: [] }), 400, "VALIDATION_FAILED");
    await expectNothingWritten(s.orgId, before);
  });

  it("requires a branch for branch roles (BRANCH_REQUIRED), before branch lookup", async () => {
    const s = await shop();
    const before = await snapshot(s.orgId);
    for (const role of ["front_desk", "groomer", "caretaker"] as const) {
      await expectError(await invite(s.headers, { email: freshEmail(), role, branchIds: [] }), 400, "BRANCH_REQUIRED");
    }
    await expectNothingWritten(s.orgId, before);
  });

  it("answers NOT_FOUND for an unknown branch id and for another organization's branch id alike (F07)", async () => {
    const s = await shop();
    const other = await shop();
    const member = await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    const before = await snapshot(s.orgId);
    for (const branchIds of [[randomUUID()], [other.branchIds[0]], [s.branchIds[0]!, other.branchIds[0]]]) {
      const res = await invite(s.headers, { email: freshEmail(), role: "groomer", branchIds });
      await expectError(res, 404, "NOT_FOUND");
    }
    // Step 6 comes before ALREADY_MEMBER (step 8).
    await expectError(await invite(s.headers, { email: member.email, role: "groomer", branchIds: [randomUUID()] }), 404, "NOT_FOUND");
    await expectNothingWritten(s.orgId, before);
  });

  it("answers ALREADY_MEMBER for an active member's email, in any case, before the plan limit", async () => {
    const s = await shop("owner", 2);
    const member = await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    const before = await snapshot(s.orgId);
    for (const email of [member.email, member.email.toUpperCase()]) {
      await expectError(await invite(s.headers, { email, role: "caretaker", branchIds: [s.branchIds[1]!] }), 409, "ALREADY_MEMBER");
    }
    await expectNothingWritten(s.orgId, before);
  });

  it("counts owner, active members and unexpired pending invitations against max_staff; expired ones and a re-invite's own row do not count", async () => {
    const s = await shop("owner", 3);
    await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    await insertInvitationRow(infra, {
      orgId: s.orgId,
      email: freshEmail(),
      role: "groomer",
      invitedByUserId: s.userId,
      expiresAt: FIXED_NOW,
    });
    const pending = freshEmail();
    expect((await invite(s.headers, { email: pending, role: "groomer", branchIds: [s.branchIds[0]!] })).statusCode).toBe(201);
    mail.sent.length = 0;
    const before = await snapshot(s.orgId);
    await expectError(
      await invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] }),
      402,
      "PLAN_LIMIT_REACHED",
    );
    await expectNothingWritten(s.orgId, before);
    expect((await invite(s.headers, { email: pending, role: "caretaker", branchIds: [s.branchIds[1]!] })).statusCode).toBe(201);
  });

  it("treats max_staff null as unlimited", async () => {
    const s = await shop("owner", null);
    for (let i = 0; i < 3; i++)
      expect((await invite(s.headers, { email: freshEmail(), role: "owner", branchIds: [] })).statusCode).toBe(201);
  });
});

describe("failures, concurrency and logs", () => {
  it("fails closed with INTERNAL when the organization has no subscription", async () => {
    const s = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    const email = freshEmail();
    const before = await snapshot(s.orgId);
    const res = await invite(s.headers, { email, role: "groomer", branchIds: s.branchIds });
    await expectError(res, 500, "INTERNAL");
    await expectNothingWritten(s.orgId, before);
    expect(captured()).not.toContain(email);
  });

  it("rolls back when the audit write fails: INTERNAL, no invitation, no email, no address in the logs", async () => {
    const s = await shop();
    const email = freshEmail();
    const old = await insertInvitationRow(infra, {
      orgId: s.orgId,
      email,
      role: "groomer",
      invitedByUserId: s.userId,
      expiresAt: new Date(EXPIRES),
    });
    const before = await snapshot(s.orgId);
    fail.audit = true;
    try {
      await expectError(await invite(s.headers, { email, role: "groomer", branchIds: [s.branchIds[0]!] }), 500, "INTERNAL");
    } finally {
      fail.audit = false;
    }
    expect(before.invitations.find((r) => r.id === old)).toMatchObject({ revokedAt: null });
    await expectNothingWritten(s.orgId, before);
    expect(captured()).toContain("unexpected error");
    expect(captured()).not.toContain(email);
  });

  it("a failing query → INTERNAL with the unexpected-error log line, but neither the address nor the query params are logged", async () => {
    const s = await shop();
    const email = freshEmail();
    const before = await snapshot(s.orgId);
    fail.query = true;
    let res: Awaited<ReturnType<typeof invite>>;
    try {
      res = await invite(s.headers, { email, role: "groomer", branchIds: [s.branchIds[0]!] });
    } finally {
      fail.query = false;
    }
    await expectError(res, 500, "INTERNAL");
    await expectNothingWritten(s.orgId, before);
    const reqId = res.headers["x-request-id"];
    expect(logs.map((l) => JSON.parse(l) as Record<string, unknown>).some((l) => l.msg === "unexpected error" && l.reqId === reqId)).toBe(
      true,
    );
    expect(captured()).not.toContain(email);
    expect(captured()).toContain("SQLSTATE 42703");
  });

  it("keeps the invitation and the 201 when the email cannot be sent; the log has no token, address or link", async () => {
    const s = await shop();
    const email = freshEmail();
    mail.failWith = Object.assign(new Error(`550 rejected <${email}> ${testConfig.APP_ORIGIN}/invite#token=x`), { code: "EENVELOPE" });
    const res = await invite(s.headers, { email, role: "groomer", branchIds: [s.branchIds[0]!] });
    expect(res.statusCode).toBe(201);
    expect(await invitationsOf(infra, s.orgId)).toHaveLength(1);
    const all = captured();
    expect(all).toContain("EENVELOPE");
    expect(all).not.toContain(email);
    expect(all).not.toContain("/invite#token=");
  });

  it("never lets parallel invites exceed max_staff", async () => {
    const s = await shop("owner", 3);
    await addMember(app, infra, s.orgId, { role: "groomer", branchIds: [s.branchIds[0]!] });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 402, 402, 402]);
    expect(await invitationsOf(infra, s.orgId)).toHaveLength(1);
  });

  it("leaves exactly one pending invitation after parallel re-invites of the same email", async () => {
    const s = await shop();
    const email = freshEmail();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => invite(s.headers, { email, role: "groomer", branchIds: [s.branchIds[0]!] })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
    const rows = await invitationsOf(infra, s.orgId);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
  });

  it("never logs an invitation token", async () => {
    const s = await shop();
    await invite(s.headers, { email: freshEmail(), role: "groomer", branchIds: [s.branchIds[0]!] });
    const token = tokenOf(mail.sent[0]!.text)!;
    expect(captured()).not.toContain(token);
    expect(captured()).not.toContain(token.split(".")[1]);
  });
});
