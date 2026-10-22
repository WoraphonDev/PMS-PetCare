import { randomBytes, randomUUID } from "node:crypto";
import { InvitationAcceptResponse } from "@app/contracts";
import { membership, membershipBranch, withTenant } from "@app/db";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import type { BackgroundWork } from "../../src/modules/identity";
import { EMAIL_SENDER, type FakeEmailSender } from "../../src/modules/notification/email";
import { INVITATION_MAIL_BACKGROUND } from "../../src/modules/org/invitation-email";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  addMember,
  auditOf,
  call,
  expectError,
  FIXED_NOW,
  holdSubscriptionLock,
  invitationsOf,
  invitationWithToken,
  loginCookie,
  membershipBranchesOf,
  membershipsOf,
  outboxOf,
  seedStaffPlan,
  signedInAccount,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-invitation-accept · #rule-staff-check-and-lock · #rule-staff-capacity ·
// #rule-invitation-token · #rule-email-login-policy · F03 · F04 · F09 · §6 staff.joined
const fail = vi.hoisted(() => ({ audit: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (fail.audit && args[1].action === "staff.joined") throw new Error("forced audit failure");
      return original.writeAudit(...args);
    },
  };
});

const logs: string[] = [];
let spies: MockInstance[] = [];
let infra: TestInfra;
let app: NestFastifyApplication;
const clock = { now: FIXED_NOW };
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(clock.now));
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
  clock.now = FIXED_NOW;
  logs.length = 0;
  for (const spy of spies) spy.mockClear();
});

const EXPIRES = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const accept = (cookie: string, body: unknown) => call(app, "POST", "/invitations/accept", { cookie }, body);
const captured = () => [...logs, ...spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)))].join("\n");
const sql = (text: string, values: unknown[]) => infra.platformDb.$client.query(text, values);

/** Owner shop with branches A, B (5 seats) and a logged-in invitee holding a pending groomer invitation for A. */
async function fixture(role: "groomer" | "manager" = "groomer") {
  const shop = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
  await seedStaffPlan(infra, shop.orgId, 5);
  const invitee = await signedInAccount(app, infra, "Mai");
  const branchIds = role === "groomer" ? [shop.branchIds[0]!] : [];
  const inv = await invitationWithToken(infra, {
    orgId: shop.orgId,
    email: invitee.email,
    role,
    branchIds,
    invitedByUserId: shop.userId,
    expiresAt: EXPIRES,
  });
  return { shop, invitee, inv, branchIds };
}
async function snapshot(orgId: string) {
  const { rows: membershipBranches } = await sql(
    "select membership_id, branch_id from membership_branch where org_id = $1 order by membership_id, branch_id",
    [orgId],
  );
  const memberships = (await membershipsOf(infra, orgId)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { invitations: await invitationsOf(infra, orgId), memberships, membershipBranches, audit: await auditOf(infra, orgId) };
}
async function expectRejected(
  res: Awaited<ReturnType<typeof accept>>,
  status: number,
  code: string,
  orgId: string,
  before: Awaited<ReturnType<typeof snapshot>>,
) {
  await expectError(res, status, code);
  expect(await snapshot(orgId)).toEqual(before);
}
/** Answers without waiting for any tenant lock: the subscription row is held by another transaction meanwhile. */
async function expectAnswersWhileLocked(orgId: string, send: () => ReturnType<typeof accept>) {
  const lock = await holdSubscriptionLock(infra, orgId);
  try {
    const res = await Promise.race([send(), new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3000))]);
    expect(res, "request waited for the subscription lock").not.toBe("timeout");
    return res as Awaited<ReturnType<typeof accept>>;
  } finally {
    await lock.release();
  }
}

describe("invitation.accept happy paths", () => {
  it("creates an active membership with the invitation's role and branches, audits staff.joined and needs no X-Org-Id", async () => {
    const { shop, invitee, inv, branchIds } = await fixture();
    const res = await accept(invitee.cookie, { token: inv.token });
    expect(res.statusCode, res.body).toBe(200);
    const body = InvitationAcceptResponse.parse(res.json());
    expect(body).toEqual({ orgId: shop.orgId, membershipId: expect.any(String), role: "groomer", branchIds });
    const row = (await membershipsOf(infra, shop.orgId)).find((m) => m.userId === invitee.userId);
    expect(row).toMatchObject({ id: body.membershipId, role: "groomer", status: "active", displayName: "Mai" });
    expect(await membershipBranchesOf(infra, body.membershipId)).toEqual(branchIds);
    expect((await invitationsOf(infra, shop.orgId))[0]).toMatchObject({ acceptedAt: FIXED_NOW, updatedAt: FIXED_NOW, revokedAt: null });
    const audit = await auditOf(infra, shop.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "staff.joined",
      actorUserId: invitee.userId,
      entityType: "membership",
      entityId: body.membershipId,
      before: null,
      after: { role: "groomer", branchIds, invitationId: inv.id },
      occurredAt: FIXED_NOW,
    });
    expect(await outboxOf(infra, shop.orgId)).toEqual([]);
    const me = (await call(app, "GET", "/me", { cookie: invitee.cookie })).json();
    expect(me.memberships.map((m: { org: { id: string } }) => m.org.id)).toContain(shop.orgId);
    expect(JSON.stringify([res.json(), audit, captured()])).not.toContain(inv.token);
  });

  it("does not compare against max_staff: a full plan still accepts the reserved seat", async () => {
    const { shop, invitee, inv } = await fixture();
    await sql("update plan set max_staff = 1 where id = (select plan_id from subscription where org_id = $1)", [shop.orgId]);
    expect((await accept(invitee.cookie, { token: inv.token })).statusCode).toBe(200);
  });

  it("reactivates a removed membership: role and branches from the invitation, display_name kept, audit before { status: 'removed' }", async () => {
    const shop = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
    await seedStaffPlan(infra, shop.orgId, 5);
    const former = await addMember(app, infra, shop.orgId, {
      role: "groomer",
      branchIds: [shop.branchIds[0]!],
      status: "removed",
      displayName: "Old name",
    });
    const cookie = await loginCookie(app, former.email);
    const inv = await invitationWithToken(infra, {
      orgId: shop.orgId,
      email: former.email,
      role: "caretaker",
      branchIds: [shop.branchIds[1]!],
      invitedByUserId: shop.userId,
      expiresAt: EXPIRES,
    });
    const res = await accept(cookie, { token: inv.token });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ orgId: shop.orgId, membershipId: former.membershipId, role: "caretaker", branchIds: [shop.branchIds[1]] });
    const row = (await membershipsOf(infra, shop.orgId)).find((m) => m.id === former.membershipId);
    expect(row).toMatchObject({ status: "active", role: "caretaker", displayName: "Old name", updatedAt: FIXED_NOW });
    expect(await membershipBranchesOf(infra, former.membershipId)).toEqual([shop.branchIds[1]]);
    expect((await membershipsOf(infra, shop.orgId)).filter((m) => m.userId === former.userId)).toHaveLength(1);
    expect((await auditOf(infra, shop.orgId)).at(-1)).toMatchObject({
      action: "staff.joined",
      entityId: former.membershipId,
      before: { status: "removed" },
      after: { role: "caretaker", branchIds: [shop.branchIds[1]], invitationId: inv.id },
    });
  });

  it("treats a case-only email difference as a match", async () => {
    const { shop, invitee, inv } = await fixture();
    await sql('update "user" set email = $1 where id = $2', [invitee.email.toUpperCase(), invitee.userId]);
    expect((await accept(invitee.cookie, { token: inv.token })).statusCode).toBe(200);
    expect((await membershipsOf(infra, shop.orgId)).some((m) => m.userId === invitee.userId)).toBe(true);
  });
});

describe("invitation.accept check order (§14 steps 1–11)", () => {
  it("1: guards — no session → UNAUTHENTICATED; must_change_password → PASSWORD_CHANGE_REQUIRED", async () => {
    const { shop, invitee, inv } = await fixture();
    const before = await snapshot(shop.orgId);
    await expectRejected(
      await call(app, "POST", "/invitations/accept", {}, { token: inv.token }),
      401,
      "UNAUTHENTICATED",
      shop.orgId,
      before,
    );
    await sql('update "user" set must_change_password = true where id = $1', [invitee.userId]);
    await expectRejected(await accept(invitee.cookie, { token: inv.token }), 403, "PASSWORD_CHANGE_REQUIRED", shop.orgId, before);
  });

  it("2: invalid body → VALIDATION_FAILED at details.fields.<key>", async () => {
    const { shop, invitee, inv } = await fixture();
    const before = await snapshot(shop.orgId);
    for (const [body, field] of [
      [{}, "token"],
      [{ token: "" }, "token"],
      [{ token: 1 }, "token"],
      [{ token: inv.token, orgId: shop.orgId }, "orgId"],
    ] as const) {
      const error = await expectError(await accept(invitee.cookie, body), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), JSON.stringify(body)).toContain(field);
    }
    expect(await snapshot(shop.orgId)).toEqual(before);
  });

  it("3–5: malformed token, managed account and unverified email are answered without waiting on a tenant lock", async () => {
    const { shop, invitee, inv } = await fixture();
    const before = await snapshot(shop.orgId);
    for (const token of [
      "x",
      randomUUID(),
      `${shop.orgId}.short`,
      `not-a-uuid.${randomBytes(32).toString("base64url")}`,
      `${inv.token}x`,
    ]) {
      await expectRejected(
        await expectAnswersWhileLocked(shop.orgId, () => accept(invitee.cookie, { token })),
        410,
        "INVITATION_INVALID",
        shop.orgId,
        before,
      );
    }
    await sql('update "user" set email_verified = false where id = $1', [invitee.userId]);
    await expectRejected(
      await expectAnswersWhileLocked(shop.orgId, () => accept(invitee.cookie, { token: inv.token })),
      401,
      "UNAUTHENTICATED",
      shop.orgId,
      before,
    );
    // Managed comes before the verified-email check (step 4 before 5): still unverified, now managed.
    await sql('update "user" set is_managed = true, managed_by_org_id = $1 where id = $2', [shop.orgId, invitee.userId]);
    await expectRejected(
      await expectAnswersWhileLocked(shop.orgId, () => accept(invitee.cookie, { token: inv.token })),
      410,
      "INVITATION_INVALID",
      shop.orgId,
      before,
    );
  });

  it("6: unknown token, a token whose org does not exist, and an email mismatch → INVITATION_INVALID (never INTERNAL)", async () => {
    const { shop, invitee } = await fixture();
    const other = await signedInAccount(app, infra);
    const before = await snapshot(shop.orgId);
    const unknown = `${shop.orgId}.${randomBytes(32).toString("base64url")}`;
    const noOrg = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
    for (const token of [unknown, noOrg])
      await expectRejected(await accept(invitee.cookie, { token }), 410, "INVITATION_INVALID", shop.orgId, before);
    const forOther = await invitationWithToken(infra, {
      orgId: shop.orgId,
      email: other.email,
      role: "groomer",
      branchIds: [shop.branchIds[0]!],
      invitedByUserId: shop.userId,
      expiresAt: EXPIRES,
    });
    const withOther = await snapshot(shop.orgId);
    await expectRejected(await accept(invitee.cookie, { token: forOther.token }), 410, "INVITATION_INVALID", shop.orgId, withOther);
  });

  it("6: accepted, revoked and expired (at expires_at and after) invitations → INVITATION_INVALID", async () => {
    const { shop, invitee } = await fixture();
    const make = (state = {}) =>
      invitationWithToken(
        infra,
        {
          orgId: shop.orgId,
          email: invitee.email,
          role: "groomer",
          branchIds: [shop.branchIds[0]!],
          invitedByUserId: shop.userId,
          expiresAt: EXPIRES,
        },
        state,
      );
    const accepted = await make({ acceptedAt: FIXED_NOW });
    const revoked = await make({ revokedAt: FIXED_NOW });
    const live = await make();
    const before = await snapshot(shop.orgId);
    for (const t of [accepted.token, revoked.token])
      await expectRejected(await accept(invitee.cookie, { token: t }), 410, "INVITATION_INVALID", shop.orgId, before);
    for (const at of [EXPIRES, new Date(EXPIRES.getTime() + 1)]) {
      clock.now = at;
      await expectRejected(await accept(invitee.cookie, { token: live.token }), 410, "INVITATION_INVALID", shop.orgId, before);
    }
    clock.now = new Date(EXPIRES.getTime() - 1);
    expect((await accept(invitee.cookie, { token: live.token })).statusCode).toBe(200);
  });

  it("6: an invitation replaced by a re-invite → INVITATION_INVALID; the new one works", async () => {
    const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
    await seedStaffPlan(infra, shop.orgId, 5);
    const invitee = await signedInAccount(app, infra);
    const mail = app.get<FakeEmailSender>(EMAIL_SENDER);
    const send = async () => {
      expect(
        (await call(app, "POST", "/staff/invitations", shop.headers, { email: invitee.email, role: "groomer", branchIds: shop.branchIds }))
          .statusCode,
      ).toBe(201);
      await app.get<BackgroundWork>(INVITATION_MAIL_BACKGROUND).idle();
      return /#token=(\S+)/.exec(mail.sent.filter((m) => m.to === invitee.email).at(-1)!.text)![1]!;
    };
    const first = await send();
    const second = await send();
    await expectError(await accept(invitee.cookie, { token: first }), 410, "INVITATION_INVALID");
    expect((await accept(invitee.cookie, { token: second })).statusCode).toBe(200);
  });

  it("7: suspended organization → ORG_SUSPENDED", async () => {
    const { shop, invitee, inv } = await fixture();
    await suspend(infra, shop.orgId);
    const before = await snapshot(shop.orgId);
    await expectRejected(await accept(invitee.cookie, { token: inv.token }), 423, "ORG_SUSPENDED", shop.orgId, before);
  });

  it("8: missing subscription for an existing org and invitation → INTERNAL (fail closed), nothing written, no token logged", async () => {
    const { shop, invitee, inv } = await fixture();
    await sql("delete from subscription where org_id = $1", [shop.orgId]);
    const before = await snapshot(shop.orgId);
    await expectRejected(await accept(invitee.cookie, { token: inv.token }), 500, "INTERNAL", shop.orgId, before);
    expect(captured()).toContain("unexpected error");
    expect(captured()).not.toContain(inv.token);
  });

  it("10: an org suspended while accept waits for the locks → ORG_SUSPENDED from the re-check, nothing written", async () => {
    const { shop, invitee, inv } = await fixture();
    const before = await snapshot(shop.orgId);
    const lock = await holdSubscriptionLock(infra, shop.orgId);
    const res = accept(invitee.cookie, { token: inv.token });
    try {
      await lock.waiting();
      await suspend(infra, shop.orgId);
    } finally {
      await lock.release();
    }
    await expectRejected(await res, 423, "ORG_SUSPENDED", shop.orgId, before);
  });

  it("11: an active member → ALREADY_MEMBER; the invitation stays usable (it can still be revoked)", async () => {
    const { shop, invitee, inv } = await fixture();
    await withTenant(infra.runtimeDb, shop.orgId, async (tx) => {
      const [m] = await tx
        .insert(membership)
        .values({ orgId: shop.orgId, userId: invitee.userId, role: "front_desk", displayName: "Already" })
        .returning();
      await tx.insert(membershipBranch).values({ orgId: shop.orgId, membershipId: m!.id, branchId: shop.branchIds[1]! });
    });
    const before = await snapshot(shop.orgId);
    await expectRejected(await accept(invitee.cookie, { token: inv.token }), 409, "ALREADY_MEMBER", shop.orgId, before);
    expect((await call(app, "DELETE", `/staff/invitations/${inv.id}`, shop.headers)).statusCode).toBe(204);
  });
});

describe("atomicity", () => {
  it("a failing staff.joined audit rolls everything back on the new-member path; the invitation still works afterwards", async () => {
    const { shop, invitee, inv } = await fixture();
    const before = await snapshot(shop.orgId);
    fail.audit = true;
    try {
      await expectRejected(await accept(invitee.cookie, { token: inv.token }), 500, "INTERNAL", shop.orgId, before);
    } finally {
      fail.audit = false;
    }
    expect((await membershipsOf(infra, shop.orgId)).some((m) => m.userId === invitee.userId)).toBe(false);
    expect((await invitationsOf(infra, shop.orgId))[0]).toMatchObject({ acceptedAt: null, updatedAt: before.invitations[0]!.updatedAt });
    expect((await accept(invitee.cookie, { token: inv.token })).statusCode).toBe(200);
  });

  it("a failing staff.joined audit rolls everything back on the reactivation path", async () => {
    const shop = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
    await seedStaffPlan(infra, shop.orgId, 5);
    const former = await addMember(app, infra, shop.orgId, { role: "groomer", branchIds: [shop.branchIds[0]!], status: "removed" });
    const cookie = await loginCookie(app, former.email);
    const inv = await invitationWithToken(infra, {
      orgId: shop.orgId,
      email: former.email,
      role: "caretaker",
      branchIds: [shop.branchIds[1]!],
      invitedByUserId: shop.userId,
      expiresAt: EXPIRES,
    });
    const before = await snapshot(shop.orgId);
    fail.audit = true;
    try {
      await expectRejected(await accept(cookie, { token: inv.token }), 500, "INTERNAL", shop.orgId, before);
    } finally {
      fail.audit = false;
    }
    expect((await membershipsOf(infra, shop.orgId)).find((m) => m.id === former.membershipId)).toMatchObject({
      status: "removed",
      role: "groomer",
    });
    expect(await membershipBranchesOf(infra, former.membershipId)).toEqual([shop.branchIds[0]]);
    expect((await accept(cookie, { token: inv.token })).statusCode).toBe(200);
  });
});
