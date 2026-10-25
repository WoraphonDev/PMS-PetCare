import { randomBytes, randomUUID } from "node:crypto";
import { seedPlans, withPlatform } from "@app/db";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { EMAIL_SENDER, type FakeEmailSender } from "../../src/modules/notification/email";
import {
  auditOf,
  call,
  expectError,
  expectUnknownKeysRejected,
  FIXED_NOW,
  holdSubscriptionLock,
  invitationsOf,
  invitationWithToken,
  membershipBranchesOf,
  membershipsOf,
  seedStaffPlan,
  signedInAccount,
  suspend,
} from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

// docs/spec/features/foundation.md#contract-signup-with-invitation · #rule-signup-abuse · #rule-invitation-token · F03 ·
// F11 · §6 staff.joined — one transaction creates a verified, non-managed user with the invitation's email and joins
// the shop; no session, no cookie, no email.
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
let mail: FakeEmailSender;
beforeAll(async () => {
  infra = await createTestInfra();
  await withPlatform(infra.platformDb, seedPlans);
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
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
  fail.audit = false;
  logs.length = 0;
  for (const spy of spies) spy.mockClear();
});

// Each case seeds a shop, hashes a password and logs in; the parallel workspace run can exceed the 5 s default
// (T-0039, T-0050, T-0026-01).
const MULTI_STEP_TIMEOUT_MS = 60_000;
const EXPIRES = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const PASSWORD = "correct horse 1";
let counter = 0;
const nextIp = () => {
  counter += 1;
  return `10.44.${Math.floor(counter / 250)}.${counter % 250}`;
};
type Res = Awaited<ReturnType<typeof call>>;
const signup = (payload: unknown, remoteAddress = nextIp()) =>
  app.inject({ method: "POST", url: "/api/v1/auth/signup/invitation", payload: payload as object, remoteAddress });
const login = (identifier: string, password = PASSWORD) =>
  app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier, password }, remoteAddress: nextIp() });
const captured = () => [...logs, ...spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)))].join("\n");
const usersWith = async (email: string) =>
  (await infra.platformDb.$client.query('select * from "user" where lower(email) = lower($1)', [email])).rows;
const code = (res: Res) => [res.statusCode, res.statusCode >= 400 ? res.json().error.code : "ok"];

/** Owner shop (branches A, B, C; 5 seats) with a pending invitation for an email that has no account. */
async function fixture(
  role: "groomer" | "manager" = "groomer",
  state: { acceptedAt?: Date; revokedAt?: Date } = {},
  expiresAt = EXPIRES,
  email = `${randomUUID()}@example.com`,
) {
  const shop = await seedOrg(app, infra, { role: "owner", branches: ["A", "B", "C"] });
  await seedStaffPlan(infra, shop.orgId, 5);
  const branchIds = role === "groomer" ? [shop.branchIds[0]!, shop.branchIds[2]!] : [];
  const inv = await invitationWithToken(
    infra,
    { orgId: shop.orgId, email, role, branchIds, invitedByUserId: shop.userId, expiresAt },
    state,
  );
  return { shop, email, inv, branchIds };
}
async function snapshot(orgId: string, email: string) {
  return {
    users: await usersWith(email),
    invitations: await invitationsOf(infra, orgId),
    memberships: await membershipsOf(infra, orgId),
    audit: await auditOf(infra, orgId),
    mails: mail.sent.length,
  };
}
async function expectNothingWritten(res: Res, status: number, errorCode: string, orgId: string, email: string, before: unknown) {
  await expectError(res, status, errorCode);
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(await snapshot(orgId, email)).toEqual(before);
}

describe("auth.signupWithInvitation happy path", () => {
  it(
    "creates a verified, non-managed user with the invitation's email, joins with role and branches, audits staff.joined",
    async () => {
      const { shop, email, inv, branchIds } = await fixture();
      const sent = mail.sent.length;
      const res = await signup({ token: inv.token, displayName: "  น้องใหม่  ", password: PASSWORD });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toEqual({ orgId: shop.orgId, role: "groomer" });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(mail.sent.length).toBe(sent);

      const [created] = await usersWith(email);
      expect(created).toMatchObject({
        email,
        name: "น้องใหม่",
        email_verified: true,
        is_managed: false,
        must_change_password: false,
        managed_by_org_id: null,
      });
      const { rows: sessions } = await infra.platformDb.$client.query("select 1 from session where user_id = $1", [created.id]);
      expect(sessions).toHaveLength(0);

      const member = (await membershipsOf(infra, shop.orgId)).find((m) => m.userId === created.id)!;
      expect(member).toMatchObject({ role: "groomer", status: "active", displayName: "น้องใหม่" });
      expect(await membershipBranchesOf(infra, member.id)).toEqual([...branchIds].sort());
      expect((await invitationsOf(infra, shop.orgId))[0]).toMatchObject({ acceptedAt: FIXED_NOW, revokedAt: null });
      const joined = (await auditOf(infra, shop.orgId)).filter((a) => a.action === "staff.joined");
      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatchObject({
        actorUserId: created.id,
        entityType: "membership",
        entityId: member.id,
        before: null,
        after: { role: "groomer", branchIds, invitationId: inv.id },
      });
      expect(captured()).not.toContain(inv.token);
      expect(captured()).not.toContain(PASSWORD);

      // Verified: the new account logs in straight away with the invitation's email.
      const signedIn = await login(email);
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      expect(signedIn.json()).toMatchObject({ twoFactorRequired: false, mustChangePassword: false });
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "an org-wide role joins with no branches",
    async () => {
      const { shop, email, inv } = await fixture("manager");
      const res = await signup({ token: inv.token, displayName: "Manager", password: PASSWORD });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toEqual({ orgId: shop.orgId, role: "manager" });
      const [created] = await usersWith(email);
      const member = (await membershipsOf(infra, shop.orgId)).find((m) => m.userId === created.id)!;
      expect(await membershipBranchesOf(infra, member.id)).toEqual([]);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "does not compare against max_staff: a full plan still takes the reserved seat",
    async () => {
      const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
      await seedStaffPlan(infra, shop.orgId, 2); // owner + this invitation
      const email = `${randomUUID()}@example.com`;
      const inv = await invitationWithToken(infra, {
        orgId: shop.orgId,
        email,
        role: "groomer",
        branchIds: shop.branchIds,
        invitedByUserId: shop.userId,
        expiresAt: EXPIRES,
      });
      expect((await signup({ token: inv.token, displayName: "Full", password: PASSWORD })).statusCode).toBe(201);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("auth.signupWithInvitation errors", () => {
  it("invalid body → VALIDATION_FAILED at details.fields.<key> (F11 password, displayName length, no email)", async () => {
    const base = { token: `${randomUUID()}.${"a".repeat(43)}`, displayName: "Nok", password: PASSWORD };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, password: "a".repeat(9) }, "password"],
      [{ ...base, password: "a".repeat(129) }, "password"],
      [{ ...base, displayName: "   " }, "displayName"],
      [{ ...base, displayName: "😀".repeat(101) }, "displayName"],
      [{ ...base, token: "" }, "token"],
      [{ ...base, token: "a".repeat(201) }, "token"],
      [{ ...base, email: "a@example.com" }, "email"],
    ];
    for (const [body, field] of cases) {
      const error = await expectError(await signup(body), 400, "VALIDATION_FAILED");
      expect(Object.keys((error.details as { fields: object }).fields), field).toContain(field);
    }
    await expectUnknownKeysRejected((body) => signup(body), base);
  });

  it(
    "malformed, unknown and unknown-org tokens → INVITATION_INVALID",
    async () => {
      const { shop } = await fixture();
      const random = (orgId: string) => `${orgId}.${randomBytes(32).toString("base64url")}`;
      for (const token of ["x", `${shop.orgId}.short`, random(shop.orgId), random(randomUUID())]) {
        await expectError(await signup({ token, displayName: "Nok", password: PASSWORD }), 410, "INVITATION_INVALID");
      }
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "accepted, revoked and expired (at expires_at and after) invitations → INVITATION_INVALID, nothing written",
    async () => {
      for (const [state, expiresAt] of [
        [{ acceptedAt: FIXED_NOW }, EXPIRES],
        [{ revokedAt: FIXED_NOW }, EXPIRES],
        [{}, FIXED_NOW],
        [{}, new Date(FIXED_NOW.getTime() - 1)],
      ] as const) {
        const { shop, email, inv } = await fixture("groomer", state, expiresAt);
        const before = await snapshot(shop.orgId, email);
        await expectNothingWritten(
          await signup({ token: inv.token, displayName: "Nok", password: PASSWORD }),
          410,
          "INVITATION_INVALID",
          shop.orgId,
          email,
          before,
        );
      }
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "suspended shop → ORG_SUSPENDED, nothing written",
    async () => {
      const { shop, email, inv } = await fixture();
      await suspend(infra, shop.orgId);
      const before = await snapshot(shop.orgId, email);
      await expectNothingWritten(
        await signup({ token: inv.token, displayName: "Nok", password: PASSWORD }),
        423,
        "ORG_SUSPENDED",
        shop.orgId,
        email,
        before,
      );
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "missing subscription for an existing org and invitation → INTERNAL (fail closed), nothing written, no token logged",
    async () => {
      const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
      const email = `${randomUUID()}@example.com`;
      const inv = await invitationWithToken(infra, {
        orgId: shop.orgId,
        email,
        role: "groomer",
        branchIds: shop.branchIds,
        invitedByUserId: shop.userId,
        expiresAt: EXPIRES,
      });
      const before = await snapshot(shop.orgId, email);
      await expectNothingWritten(
        await signup({ token: inv.token, displayName: "Nok", password: PASSWORD }),
        500,
        "INTERNAL",
        shop.orgId,
        email,
        before,
      );
      expect(captured()).not.toContain(inv.token);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "an existing account with that email in any case (verified or not) → CONFLICT, nothing written, invitation still usable",
    async () => {
      const existing = await signedInAccount(app, infra);
      const { shop, inv } = await fixture("groomer", {}, EXPIRES, existing.email.toUpperCase());
      const before = await snapshot(shop.orgId, existing.email);
      await expectNothingWritten(
        await signup({ token: inv.token, displayName: "Nok", password: PASSWORD }),
        409,
        "CONFLICT",
        shop.orgId,
        existing.email,
        before,
      );
      // The existing account logs in and accepts instead.
      const res = await call(app, "POST", "/invitations/accept", { cookie: existing.cookie }, { token: inv.token });
      expect(res.statusCode, res.body).toBe(200);

      const unverified = `${randomUUID()}@example.com`;
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: {
          email: unverified,
          password: PASSWORD,
          displayName: "U",
          orgName: "U",
          orgSlug: `u-${randomUUID().slice(0, 8)}`,
          branchName: "U",
        },
        remoteAddress: nextIp(),
      });
      expect(created.statusCode, created.body).toBe(201);
      const second = await fixture("groomer", {}, EXPIRES, unverified);
      await expectError(await signup({ token: second.inv.token, displayName: "Nok", password: PASSWORD }), 409, "CONFLICT");
      expect(await usersWith(unverified)).toHaveLength(1);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "a token for shop A never writes in shop B",
    async () => {
      const a = await fixture();
      const b = await fixture();
      const before = await snapshot(b.shop.orgId, b.email);
      expect((await signup({ token: a.inv.token, displayName: "Nok", password: PASSWORD })).statusCode).toBe(201);
      expect(await snapshot(b.shop.orgId, b.email)).toEqual(before);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("abuse limit (5 schema-valid attempts / hour / trusted IP, prefix signup-invite)", () => {
  it(
    "the 6th schema-valid attempt from one IP → RATE_LIMITED; invalid bodies are not counted; other prefixes untouched",
    async () => {
      const ip = nextIp();
      const body = () => ({ token: `${randomUUID()}.${randomBytes(32).toString("base64url")}`, displayName: "Nok", password: PASSWORD });
      await expectError(await signup({ token: "", displayName: "Nok", password: PASSWORD }, ip), 400, "VALIDATION_FAILED");
      for (let i = 0; i < 5; i++) await expectError(await signup(body(), ip), 410, "INVITATION_INVALID");
      const key = `signup-invite:${encodeURIComponent(ip)}`;
      expect(await infra.valkey.get(key)).toBe("5");
      expect(await infra.valkey.ttl(key)).toBeGreaterThan(3500);

      const { shop, email, inv } = await fixture();
      const before = await snapshot(shop.orgId, email);
      await expectNothingWritten(
        await signup({ token: inv.token, displayName: "Nok", password: PASSWORD }, ip),
        429,
        "RATE_LIMITED",
        shop.orgId,
        email,
        before,
      );
      expect(await infra.valkey.get(`signup-attempt:${encodeURIComponent(ip)}`)).toBeNull();
      expect((await signup({ token: inv.token, displayName: "Nok", password: PASSWORD })).statusCode).toBe(201);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "fails closed with INTERNAL when Valkey is unavailable, before any write",
    async () => {
      const { shop, email, inv } = await fixture();
      const before = await snapshot(shop.orgId, email);
      const broken = await bootTestApp(
        [],
        { write: () => {} },
        { ...infra, valkey: { eval: () => Promise.reject(new Error("down")) } as never },
      );
      try {
        const res = await broken.inject({
          method: "POST",
          url: "/api/v1/auth/signup/invitation",
          payload: { token: inv.token, displayName: "Nok", password: PASSWORD },
          remoteAddress: nextIp(),
        });
        await expectNothingWritten(res, 500, "INTERNAL", shop.orgId, email, before);
      } finally {
        await broken.close();
      }
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("atomicity", () => {
  it(
    "a failing staff.joined audit → INTERNAL and rolls everything back (no user, no membership, invitation unused); a retry works",
    async () => {
      const { shop, email, inv } = await fixture();
      const before = await snapshot(shop.orgId, email);
      fail.audit = true;
      await expectNothingWritten(
        await signup({ token: inv.token, displayName: "Nok", password: PASSWORD }),
        500,
        "INTERNAL",
        shop.orgId,
        email,
        before,
      );
      expect(captured()).not.toContain(inv.token);
      fail.audit = false;
      expect((await signup({ token: inv.token, displayName: "Nok", password: PASSWORD })).statusCode).toBe(201);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("races on the same invitation (whoever locks the invitation first wins)", () => {
  /** `first` gets the subscription lock first and `second` waits behind it, both past their unlocked preflight. */
  async function inOrder(orgId: string, first: () => Promise<Res>, second: () => Promise<Res>): Promise<[Res, Res]> {
    const lock = await holdSubscriptionLock(infra, orgId);
    let a: Promise<Res> | undefined;
    let b: Promise<Res> | undefined;
    try {
      a = first();
      await lock.waiting(1);
      b = second();
      await lock.waiting(2);
    } finally {
      await lock.release();
    }
    return [await a!, await b!];
  }
  const signupWith = (token: string) => () => signup({ token, displayName: "Nok", password: PASSWORD });

  it(
    "two signups on one token → one user and one membership; the other INVITATION_INVALID",
    async () => {
      const { shop, email, inv } = await fixture();
      const [first, second] = await inOrder(shop.orgId, signupWith(inv.token), signupWith(inv.token));
      expect([code(first), code(second)]).toEqual([
        [201, "ok"],
        [410, "INVITATION_INVALID"],
      ]);
      expect(await usersWith(email)).toHaveLength(1);
      expect((await membershipsOf(infra, shop.orgId)).filter((m) => m.role === "groomer")).toHaveLength(1);
      expect((await auditOf(infra, shop.orgId)).filter((a) => a.action === "staff.joined")).toHaveLength(1);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  for (const signupFirst of [true, false]) {
    it(
      signupFirst ? "signup first: joined; revoke → NOT_FOUND" : "revoke first: 204; signup → INVITATION_INVALID, no user",
      async () => {
        const { shop, email, inv } = await fixture();
        const revoke = () => call(app, "DELETE", `/staff/invitations/${inv.id}`, shop.headers);
        const [r1, r2] = await inOrder(
          shop.orgId,
          signupFirst ? signupWith(inv.token) : revoke,
          signupFirst ? revoke : signupWith(inv.token),
        );
        if (signupFirst) {
          expect([code(r1), code(r2)]).toEqual([
            [201, "ok"],
            [404, "NOT_FOUND"],
          ]);
          expect(await usersWith(email)).toHaveLength(1);
        } else {
          expect([code(r1), code(r2)]).toEqual([
            [204, "ok"],
            [410, "INVITATION_INVALID"],
          ]);
          expect(await usersWith(email)).toHaveLength(0);
          expect((await invitationsOf(infra, shop.orgId))[0]).toMatchObject({ acceptedAt: null, revokedAt: FIXED_NOW });
        }
      },
      MULTI_STEP_TIMEOUT_MS,
    );
  }
});
