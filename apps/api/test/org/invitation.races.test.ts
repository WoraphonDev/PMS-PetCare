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
  FIXED_NOW,
  holdSubscriptionLock,
  invitationsOf,
  invitationWithToken,
  loginCookie,
  membershipsOf,
  seedStaffPlan,
  signedInAccount,
} from "./support";

// docs/spec/features/foundation.md#rule-staff-check-and-lock · #rule-staff-capacity · #contract-invitation-accept ·
// #contract-staff-invite · #contract-staff-invitation-revoke — every race between accept and the T-0015 writers, in
// both commit orders. The order is fixed, not left to chance: another transaction holds the subscription row (lock
// step 1), `first` starts and blocks, `second` starts and blocks behind it, then the lock is released and Postgres
// grants it in arrival order. `second` has already passed every phase-1 check, so only the phase-2 re-checks can
// reject it.
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

// Each case signs up and logs in fresh accounts; the parallel workspace run can exceed the 5 s default (T-0039).
const RACE_TIMEOUT_MS = 60_000;
const EXPIRES = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
type Res = Awaited<ReturnType<typeof call>>;
const accept = (cookie: string, token: string) => () => call(app, "POST", "/invitations/accept", { cookie }, { token });
const invite = (headers: Record<string, string>, email: string, branchIds: string[]) => () =>
  call(app, "POST", "/staff/invitations", headers, { email, role: "groomer", branchIds });
const revoke = (headers: Record<string, string>, id: string) => () => call(app, "DELETE", `/staff/invitations/${id}`, headers);

/** Runs `first` and `second` so that `first` gets the subscription lock first and `second` waits behind it. */
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

/** Owner shop with `maxStaff` seats and one logged-in invitee holding pending invitation X. */
async function scene(maxStaff = 5) {
  const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  await seedStaffPlan(infra, shop.orgId, maxStaff);
  const invitee = await signedInAccount(app, infra);
  const x = await invitationWithToken(infra, {
    orgId: shop.orgId,
    email: invitee.email,
    role: "groomer",
    branchIds: shop.branchIds,
    invitedByUserId: shop.userId,
    expiresAt: EXPIRES,
  });
  return { shop, invitee, x };
}
async function seats(orgId: string) {
  const active = (await membershipsOf(infra, orgId)).filter((m) => m.status === "active").length;
  const pending = (await invitationsOf(infra, orgId)).filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > FIXED_NOW).length;
  return active + pending;
}
const isMember = async (orgId: string, userId: string) =>
  (await membershipsOf(infra, orgId)).some((m) => m.userId === userId && m.status === "active");
const code = (res: Res) => [res.statusCode, res.statusCode >= 400 ? res.json().error.code : "ok"];

describe("invite vs accept: accept turns the reserved seat into a member, so the count does not change", () => {
  for (const acceptFirst of [true, false]) {
    const order = acceptFirst ? "accept first" : "invite first";
    it(
      `${order}: at max_staff (X included) the invite is PLAN_LIMIT_REACHED and the accept succeeds`,
      async () => {
        const { shop, invitee, x } = await scene(2); // owner + X
        const a = accept(invitee.cookie, x.token);
        const i = invite(shop.headers, `${randomUUID()}@example.com`, shop.branchIds);
        const [r1, r2] = await inOrder(shop.orgId, acceptFirst ? a : i, acceptFirst ? i : a);
        const [acc, inv] = acceptFirst ? [r1, r2] : [r2, r1];
        expect([code(acc), code(inv)]).toEqual([
          [200, "ok"],
          [402, "PLAN_LIMIT_REACHED"],
        ]);
        expect(await seats(shop.orgId)).toBe(2);
      },
      RACE_TIMEOUT_MS,
    );

    it(
      `${order}: at max_staff − 1 the invite succeeds`,
      async () => {
        const { shop, invitee, x } = await scene(3);
        const a = accept(invitee.cookie, x.token);
        const i = invite(shop.headers, `${randomUUID()}@example.com`, shop.branchIds);
        const [r1, r2] = await inOrder(shop.orgId, acceptFirst ? a : i, acceptFirst ? i : a);
        expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 201]);
        expect(await seats(shop.orgId)).toBe(3);
      },
      RACE_TIMEOUT_MS,
    );
  }
});

describe("re-invite vs accept (same email)", () => {
  it(
    "accept first: member, re-invite → ALREADY_MEMBER, no new invitation",
    async () => {
      const { shop, invitee, x } = await scene();
      const [acc, inv] = await inOrder(shop.orgId, accept(invitee.cookie, x.token), invite(shop.headers, invitee.email, shop.branchIds));
      expect([code(acc), code(inv)]).toEqual([
        [200, "ok"],
        [409, "ALREADY_MEMBER"],
      ]);
      expect(await isMember(shop.orgId, invitee.userId)).toBe(true);
      expect(await invitationsOf(infra, shop.orgId)).toHaveLength(1);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "re-invite first: X revoked, accept (already past its preflight) → INVITATION_INVALID, no member, one new pending invitation",
    async () => {
      const { shop, invitee, x } = await scene();
      const [inv, acc] = await inOrder(shop.orgId, invite(shop.headers, invitee.email, shop.branchIds), accept(invitee.cookie, x.token));
      expect([code(inv), code(acc)]).toEqual([
        [201, "ok"],
        [410, "INVITATION_INVALID"],
      ]);
      expect(await isMember(shop.orgId, invitee.userId)).toBe(false);
      const rows = await invitationsOf(infra, shop.orgId);
      expect(rows.find((r) => r.id === x.id)!.revokedAt).toEqual(FIXED_NOW);
      expect(rows.filter((r) => r.id !== x.id && !r.revokedAt && !r.acceptedAt)).toHaveLength(1);
    },
    RACE_TIMEOUT_MS,
  );
});

describe("revoke vs accept", () => {
  it(
    "accept first: member; revoke → NOT_FOUND",
    async () => {
      const { shop, invitee, x } = await scene();
      const [acc, rev] = await inOrder(shop.orgId, accept(invitee.cookie, x.token), revoke(shop.headers, x.id));
      expect([code(acc), code(rev)]).toEqual([
        [200, "ok"],
        [404, "NOT_FOUND"],
      ]);
      expect((await invitationsOf(infra, shop.orgId))[0]).toMatchObject({ acceptedAt: FIXED_NOW, revokedAt: null });
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "revoke first: 204; accept (already past its preflight) → INVITATION_INVALID and no membership from the revoked token",
    async () => {
      const { shop, invitee, x } = await scene();
      const [rev, acc] = await inOrder(shop.orgId, revoke(shop.headers, x.id), accept(invitee.cookie, x.token));
      expect([code(rev), code(acc)]).toEqual([
        [204, "ok"],
        [410, "INVITATION_INVALID"],
      ]);
      expect(await isMember(shop.orgId, invitee.userId)).toBe(false);
      expect((await invitationsOf(infra, shop.orgId))[0]).toMatchObject({ acceptedAt: null, revokedAt: FIXED_NOW });
    },
    RACE_TIMEOUT_MS,
  );
});

describe("double accept", () => {
  it(
    "the second accept (already past its preflight) → INVITATION_INVALID; one membership; one staff.joined audit row",
    async () => {
      const { shop, invitee, x } = await scene();
      const [first, second] = await inOrder(shop.orgId, accept(invitee.cookie, x.token), accept(invitee.cookie, x.token));
      expect([code(first), code(second)]).toEqual([
        [200, "ok"],
        [410, "INVITATION_INVALID"],
      ]);
      expect((await membershipsOf(infra, shop.orgId)).filter((m) => m.userId === invitee.userId)).toHaveLength(1);
      expect((await auditOf(infra, shop.orgId)).filter((a) => a.action === "staff.joined")).toHaveLength(1);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "a removed member's double accept reactivates once",
    async () => {
      const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
      await seedStaffPlan(infra, shop.orgId, 5);
      const former = await addMember(app, infra, shop.orgId, { role: "groomer", branchIds: shop.branchIds, status: "removed" });
      const cookie = await loginCookie(app, former.email);
      const x = await invitationWithToken(infra, {
        orgId: shop.orgId,
        email: former.email,
        role: "groomer",
        branchIds: shop.branchIds,
        invitedByUserId: shop.userId,
        expiresAt: EXPIRES,
      });
      const [first, second] = await inOrder(shop.orgId, accept(cookie, x.token), accept(cookie, x.token));
      expect([code(first), code(second)]).toEqual([
        [200, "ok"],
        [410, "INVITATION_INVALID"],
      ]);
      expect((await auditOf(infra, shop.orgId)).filter((a) => a.action === "staff.joined")).toHaveLength(1);
    },
    RACE_TIMEOUT_MS,
  );
});
