import { randomBytes, randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import {
  auditOf,
  call,
  expectError,
  expectUnknownKeysRejected,
  FIXED_NOW,
  holdSubscriptionLock,
  invitationsOf,
  invitationWithToken,
  membershipsOf,
  seedStaffPlan,
  signedInAccount,
  suspend,
} from "./support";

// docs/spec/features/foundation.md#contract-invitation-preview · #rule-invitation-token — public, read-only: no session,
// no X-Org-Id, no lock, no write, no audit, and nothing that says whether the email already has an account.
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

// Each case seeds a shop and accounts; the parallel workspace run can exceed the 5 s default (T-0039, T-0050).
const MULTI_STEP_TIMEOUT_MS = 30_000;
const EXPIRES = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const preview = (body: unknown, headers: Record<string, string> = {}) => call(app, "POST", "/invitations/preview", headers, body);
const captured = () => [...logs, ...spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)))].join("\n");

/** Shop with branches named out of order, so the response order proves the sort by name. */
async function fixture(role: "groomer" | "manager" = "groomer", state: { acceptedAt?: Date; revokedAt?: Date } = {}, expiresAt = EXPIRES) {
  const shop = await seedOrg(app, infra, { role: "owner", branches: ["สาขา ข", "สาขา ก", "สาขา ค"] });
  await infra.platformDb.$client.query("update organization set display_name = $2 where id = $1", [shop.orgId, "ร้านน้องหมา"]);
  const email = `${randomUUID()}@example.com`;
  const branchIds = role === "groomer" ? [shop.branchIds[0]!, shop.branchIds[1]!] : [];
  const inv = await invitationWithToken(
    infra,
    { orgId: shop.orgId, email, role, branchIds, invitedByUserId: shop.userId, expiresAt },
    state,
  );
  return { shop, email, inv };
}
async function snapshot(orgId: string) {
  return {
    invitations: await invitationsOf(infra, orgId),
    memberships: await membershipsOf(infra, orgId),
    audit: await auditOf(infra, orgId),
  };
}

describe("invitation.preview happy path", () => {
  it(
    "returns shop name, role, only the invitation's branch names sorted by name, the invited email and expiry — public, no writes",
    async () => {
      const { shop, email, inv } = await fixture();
      const before = await snapshot(shop.orgId);
      const res = await preview({ token: inv.token });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        orgDisplayName: "ร้านน้องหมา",
        role: "groomer",
        branchNames: ["สาขา ก", "สาขา ข"],
        email,
        expiresAt: EXPIRES.toISOString(),
      });
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await snapshot(shop.orgId)).toEqual(before);
      expect(captured()).not.toContain(inv.token);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "an org-wide role has no branch names; the answer does not depend on whether the email already has an account",
    async () => {
      const { inv } = await fixture("manager");
      const res = await preview({ token: inv.token });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: "manager", branchNames: [] });

      const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
      const existing = await signedInAccount(app, infra);
      const known = await invitationWithToken(infra, {
        orgId: shop.orgId,
        email: existing.email,
        role: "groomer",
        branchIds: shop.branchIds,
        invitedByUserId: shop.userId,
        expiresAt: EXPIRES,
      });
      const body = (await preview({ token: known.token })).json();
      expect(Object.keys(body).sort()).toEqual(["branchNames", "email", "expiresAt", "orgDisplayName", "role"]);
      // A logged-in caller gets the same answer; the session is ignored.
      expect((await preview({ token: known.token }, { cookie: existing.cookie })).json()).toEqual(body);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "takes no lock: answers while another transaction holds the subscription row",
    async () => {
      const { shop, inv } = await fixture();
      await seedStaffPlan(infra, shop.orgId, 5);
      const lock = await holdSubscriptionLock(infra, shop.orgId);
      try {
        const res = await Promise.race([
          preview({ token: inv.token }),
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3000)),
        ]);
        expect(res, "preview waited for a lock").not.toBe("timeout");
        expect((res as Awaited<ReturnType<typeof preview>>).statusCode).toBe(200);
      } finally {
        await lock.release();
      }
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});

describe("invitation.preview errors", () => {
  it("invalid body → VALIDATION_FAILED at details.fields.<key>", async () => {
    for (const body of [{}, { token: "" }, { token: "a".repeat(201) }, { token: 1 }]) {
      const error = await expectError(await preview(body), 400, "VALIDATION_FAILED");
      expect(error.details).toMatchObject({ fields: { token: expect.any(Array) } });
    }
    await expectUnknownKeysRejected((body) => preview(body), { token: "x" });
  });

  it(
    "malformed token, unknown token and a token for an org that does not exist → INVITATION_INVALID",
    async () => {
      const { shop } = await fixture();
      const random = (orgId: string) => `${orgId}.${randomBytes(32).toString("base64url")}`;
      for (const token of ["x", `${shop.orgId}.short`, `not-a-uuid.${"a".repeat(43)}`, random(shop.orgId), random(randomUUID())]) {
        await expectError(await preview({ token }), 410, "INVITATION_INVALID");
      }
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "accepted, revoked and expired (at expires_at and after) invitations → INVITATION_INVALID",
    async () => {
      const accepted = await fixture("groomer", { acceptedAt: FIXED_NOW });
      const revoked = await fixture("groomer", { revokedAt: FIXED_NOW });
      const atExpiry = await fixture("groomer", {}, FIXED_NOW);
      const expired = await fixture("groomer", {}, new Date(FIXED_NOW.getTime() - 1));
      for (const { inv } of [accepted, revoked, atExpiry, expired]) {
        await expectError(await preview({ token: inv.token }), 410, "INVITATION_INVALID");
      }
      const live = await fixture("groomer", {}, new Date(FIXED_NOW.getTime() + 1));
      expect((await preview({ token: live.inv.token })).statusCode).toBe(200);
    },
    MULTI_STEP_TIMEOUT_MS,
  );

  it(
    "suspended shop → ORG_SUSPENDED, nothing written, no token logged",
    async () => {
      const { shop, inv } = await fixture();
      await suspend(infra, shop.orgId);
      const before = await snapshot(shop.orgId);
      await expectError(await preview({ token: inv.token }), 423, "ORG_SUSPENDED");
      expect(await snapshot(shop.orgId)).toEqual(before);
      expect(captured()).not.toContain(inv.token);
    },
    MULTI_STEP_TIMEOUT_MS,
  );
});
