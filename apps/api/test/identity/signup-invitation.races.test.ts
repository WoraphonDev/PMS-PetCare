import { randomUUID } from "node:crypto";
import { seedPlans, withPlatform } from "@app/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { auditOf, FIXED_NOW, invitationsOf, invitationWithToken, membershipsOf, seedStaffPlan } from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

// docs/spec/features/foundation.md#rule-signup-invite-email-race — the invitation lock serialises only requests on the
// same invitation. Across invitations, and against auth.signup, both requests can pass the email pre-check; the
// `user_email_unique` constraint decides, and the loser rolls back everything and answers CONFLICT (never INTERNAL).
// The commit order is forced the T-0042 way: one request is paused right after its pre-check, the other commits, then
// the paused one is released.
type Flow = "invite" | "signup";
const pause = vi.hoisted(() => ({
  flow: null as null | "invite" | "signup",
  reached: null as null | (() => void),
  release: null as null | Promise<void>,
}));
vi.mock("../../src/modules/identity/identity.repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/modules/identity/identity.repository")>();
  /** One-shot: the first request of the chosen flow waits here until the test releases it. */
  const hold = async (flow: Flow) => {
    if (pause.flow !== flow) return;
    pause.flow = null;
    pause.reached?.();
    await pause.release;
  };
  return {
    ...original,
    // auth.signupWithInvitation step 3 pre-check.
    emailTaken: async (...args: Parameters<typeof original.emailTaken>) => {
      const taken = await original.emailTaken(...args);
      await hold("invite");
      return taken;
    },
    // auth.signup: email lock + pre-check.
    lockSignupEmail: async (...args: Parameters<typeof original.lockSignupEmail>) => {
      const result = await original.lockSignupEmail(...args);
      await hold("signup");
      return result;
    },
  };
});

let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  await withPlatform(infra.platformDb, seedPlans);
  app = await bootTestApp([], undefined, infra);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date(FIXED_NOW));
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

// Two signups (password hashing) and shop seeding per case; well above the 5 s default (T-0039, T-0050).
const RACE_TIMEOUT_MS = 60_000;
const EXPIRES = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const PASSWORD = "correct horse 1";
type Res = Awaited<ReturnType<NestFastifyApplication["inject"]>>;
let counter = 0;
const nextIp = () => {
  counter += 1;
  return `10.45.${Math.floor(counter / 250)}.${counter % 250}`;
};
const inviteSignup = (token: string) => () =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/signup/invitation",
    payload: { token, displayName: "Nok", password: PASSWORD },
    remoteAddress: nextIp(),
  });
const shopSignup = (email: string, orgSlug: string) => () =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email, password: PASSWORD, displayName: "Owner", orgName: "Shop", orgSlug, branchName: "Main" },
    remoteAddress: nextIp(),
  });
const code = (res: Res) => [res.statusCode, res.statusCode >= 400 ? res.json().error.code : "ok"];
const usersWith = async (email: string) =>
  (await infra.platformDb.$client.query('select id from "user" where lower(email) = lower($1)', [email])).rows as { id: string }[];
const orgsWithSlug = async (slug: string) =>
  (await infra.platformDb.$client.query("select id from organization where slug = $1", [slug])).rows;

/** Runs `paused` until its pre-check, lets `winner` finish, then releases `paused`. */
async function pausedThenReleased(flow: Flow, paused: () => Promise<Res>, winner: () => Promise<Res>): Promise<[Res, Res]> {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    pause.reached = resolve;
  });
  pause.release = new Promise<void>((resolve) => {
    release = resolve;
  });
  pause.flow = flow;
  const loser = paused();
  try {
    await reached;
    const won = await winner();
    release();
    return [won, await loser];
  } finally {
    release();
    pause.flow = null;
  }
}

async function invitedShop(email: string) {
  const shop = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  await seedStaffPlan(infra, shop.orgId, 5);
  const inv = await invitationWithToken(infra, {
    orgId: shop.orgId,
    email,
    role: "groomer",
    branchIds: shop.branchIds,
    invitedByUserId: shop.userId,
    expiresAt: EXPIRES,
  });
  return { shop, inv };
}
/** The losing invitation left nothing: no membership for anyone new, invitation unused, no staff.joined. */
async function expectUntouched(orgId: string) {
  expect((await membershipsOf(infra, orgId)).filter((m) => m.role !== "owner")).toEqual([]);
  expect((await invitationsOf(infra, orgId))[0]).toMatchObject({ acceptedAt: null, revokedAt: null });
  expect((await auditOf(infra, orgId)).filter((a) => a.action === "staff.joined")).toEqual([]);
}
async function expectJoined(orgId: string, userId: string) {
  expect((await membershipsOf(infra, orgId)).filter((m) => m.userId === userId && m.status === "active")).toHaveLength(1);
  expect((await invitationsOf(infra, orgId))[0]!.acceptedAt).toEqual(FIXED_NOW);
  expect((await auditOf(infra, orgId)).filter((a) => a.action === "staff.joined")).toHaveLength(1);
}

describe("email races (#rule-signup-invite-email-race)", () => {
  it(
    "two shops invite the same email; both invite signups pass the pre-check → one user, the other CONFLICT and leaves nothing",
    async () => {
      const email = `${randomUUID()}@example.com`;
      const one = await invitedShop(email);
      const two = await invitedShop(email);
      const [won, lost] = await pausedThenReleased("invite", inviteSignup(one.inv.token), inviteSignup(two.inv.token));
      expect([code(won), code(lost)]).toEqual([
        [201, "ok"],
        [409, "CONFLICT"],
      ]);
      const users = await usersWith(email);
      expect(users).toHaveLength(1);
      await expectJoined(two.shop.orgId, users[0]!.id);
      await expectUntouched(one.shop.orgId);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "invite signup paused after its pre-check, auth.signup commits first → one user (the shop owner), invite signup CONFLICT",
    async () => {
      const email = `${randomUUID()}@example.com`;
      const slug = `race-${randomUUID().slice(0, 8)}`;
      const { shop, inv } = await invitedShop(email);
      const [won, lost] = await pausedThenReleased("invite", inviteSignup(inv.token), shopSignup(email, slug));
      expect([code(won), code(lost)]).toEqual([
        [201, "ok"],
        [409, "CONFLICT"],
      ]);
      expect(await usersWith(email)).toHaveLength(1);
      expect(await orgsWithSlug(slug)).toHaveLength(1);
      await expectUntouched(shop.orgId);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "auth.signup paused after its pre-check, invite signup commits first → one user (the invitee), auth.signup CONFLICT, no shop",
    async () => {
      const email = `${randomUUID()}@example.com`;
      const slug = `race-${randomUUID().slice(0, 8)}`;
      const { shop, inv } = await invitedShop(email);
      const [won, lost] = await pausedThenReleased("signup", shopSignup(email, slug), inviteSignup(inv.token));
      expect([code(won), code(lost)]).toEqual([
        [201, "ok"],
        [409, "CONFLICT"],
      ]);
      const users = await usersWith(email);
      expect(users).toHaveLength(1);
      expect(await orgsWithSlug(slug)).toEqual([]);
      await expectJoined(shop.orgId, users[0]!.id);
    },
    RACE_TIMEOUT_MS,
  );
});
