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
  invitationsOf,
  invitationWithToken,
  loginCookie,
  membershipsOf,
  seedStaffPlan,
  signedInAccount,
} from "./support";

// docs/spec/features/foundation.md#rule-staff-check-and-lock · #rule-staff-capacity · #contract-invitation-accept ·
// #contract-staff-invite · #contract-staff-invitation-revoke — every race between accept and the T-0015 writers.
// Each case runs several times so both commit orders occur.
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

const ROUNDS = 6;
// Every round signs up and logs in a fresh account; under the parallel workspace run that takes well over 5 s (T-0039).
const RACE_TIMEOUT_MS = 60_000;
const EXPIRES = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const accept = (cookie: string, token: string) => call(app, "POST", "/invitations/accept", { cookie }, { token });
const invite = (headers: Record<string, string>, email: string, branchIds: string[]) =>
  call(app, "POST", "/staff/invitations", headers, { email, role: "groomer", branchIds });

/** Owner shop with `maxStaff` seats and one logged-in invitee holding pending invitation X. */
async function scene(maxStaff: number) {
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

describe("invite vs accept", () => {
  it(
    "at max_staff (X included) a parallel invite is always PLAN_LIMIT_REACHED and the accept succeeds",
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { shop, invitee, x } = await scene(2); // owner + X
        const [a, i] = await Promise.all([
          accept(invitee.cookie, x.token),
          invite(shop.headers, `${randomUUID()}@example.com`, shop.branchIds),
        ]);
        expect([a.statusCode, i.statusCode], `round ${round}`).toEqual([200, 402]);
        expect(await seats(shop.orgId)).toBe(2);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "at max_staff − 1 a parallel invite always succeeds",
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { shop, invitee, x } = await scene(3);
        const [a, i] = await Promise.all([
          accept(invitee.cookie, x.token),
          invite(shop.headers, `${randomUUID()}@example.com`, shop.branchIds),
        ]);
        expect([a.statusCode, i.statusCode], `round ${round}`).toEqual([200, 201]);
        expect(await seats(shop.orgId)).toBe(3);
      }
    },
    RACE_TIMEOUT_MS,
  );
});

describe("re-invite vs accept (same email)", () => {
  it(
    "ends as either (member, ALREADY_MEMBER, no new invitation) or (revoked, INVITATION_INVALID, new pending) — never both",
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { shop, invitee, x } = await scene(5);
        const [a, i] = await Promise.all([accept(invitee.cookie, x.token), invite(shop.headers, invitee.email, shop.branchIds)]);
        const member = (await membershipsOf(infra, shop.orgId)).some((m) => m.userId === invitee.userId && m.status === "active");
        const rows = await invitationsOf(infra, shop.orgId);
        const pendingNew = rows.filter((r) => r.id !== x.id && !r.acceptedAt && !r.revokedAt);
        if (a.statusCode === 200) {
          expect(i.statusCode, `round ${round}`).toBe(409);
          expect(i.json().error.code).toBe("ALREADY_MEMBER");
          expect(member).toBe(true);
          expect(pendingNew).toEqual([]);
        } else {
          expect([a.statusCode, a.json().error.code, i.statusCode], `round ${round}`).toEqual([410, "INVITATION_INVALID", 201]);
          expect(member).toBe(false);
          expect(rows.find((r) => r.id === x.id)!.revokedAt).not.toBeNull();
          expect(pendingNew).toHaveLength(1);
        }
      }
    },
    RACE_TIMEOUT_MS,
  );
});

describe("revoke vs accept", () => {
  it(
    "the operation that commits first wins; a revoked token never yields a membership",
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { shop, invitee, x } = await scene(5);
        const [a, r] = await Promise.all([
          accept(invitee.cookie, x.token),
          call(app, "DELETE", `/staff/invitations/${x.id}`, shop.headers),
        ]);
        const member = (await membershipsOf(infra, shop.orgId)).some((m) => m.userId === invitee.userId);
        const row = (await invitationsOf(infra, shop.orgId)).find((i) => i.id === x.id)!;
        if (r.statusCode === 204) {
          expect([a.statusCode, a.json().error.code], `round ${round}`).toEqual([410, "INVITATION_INVALID"]);
          expect(member).toBe(false);
          expect(row).toMatchObject({ acceptedAt: null, revokedAt: FIXED_NOW });
        } else {
          expect([a.statusCode, r.statusCode, r.json().error.code], `round ${round}`).toEqual([200, 404, "NOT_FOUND"]);
          expect(member).toBe(true);
          expect(row).toMatchObject({ acceptedAt: FIXED_NOW, revokedAt: null });
        }
      }
    },
    RACE_TIMEOUT_MS,
  );
});

describe("double accept", () => {
  it(
    "one 200 and one INVITATION_INVALID; one membership; one staff.joined audit row",
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { shop, invitee, x } = await scene(5);
        const results = await Promise.all([accept(invitee.cookie, x.token), accept(invitee.cookie, x.token)]);
        expect(results.map((r) => r.statusCode).sort(), `round ${round}`).toEqual([200, 410]);
        expect((await membershipsOf(infra, shop.orgId)).filter((m) => m.userId === invitee.userId)).toHaveLength(1);
        expect((await auditOf(infra, shop.orgId)).filter((a) => a.action === "staff.joined")).toHaveLength(1);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "a removed member's double accept also reactivates once",
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
      const results = await Promise.all([accept(cookie, x.token), accept(cookie, x.token)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 410]);
      expect((await auditOf(infra, shop.orgId)).filter((a) => a.action === "staff.joined")).toHaveLength(1);
    },
    RACE_TIMEOUT_MS,
  );
});
