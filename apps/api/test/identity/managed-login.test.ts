import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AUTH, type Auth } from "../../src/modules/identity";
import { seedStaffPlan } from "../org/support";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

// docs/spec/features/foundation.md#rule-email-login-policy (T-0016-05 A) — managed accounts log in by username only;
// an email identifier, incl. the `<id>@managed.invalid` placeholder, is refused like a wrong password.
let infra: TestInfra;
let app: NestFastifyApplication;
let auth: Auth;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  auth = app.get<Auth>(AUTH);
}, 180_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await infra?.stop();
});

const PASSWORD = "first-pass-123";
let ip = 0;
const nextIp = () => `10.18.${Math.floor(++ip / 250)}.${ip % 250}`;
const login = (identifier: string, password = PASSWORD, remoteAddress = nextIp()) =>
  app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier, password }, remoteAddress });
const sessions = (userId: string) => infra.platformDb.query.session.findMany({ where: (s, { eq }) => eq(s.userId, userId) });
function denied(res: { statusCode: number; headers: Record<string, unknown>; json(): unknown }) {
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED", message: "Invalid credentials" } });
  expect(res.headers["set-cookie"]).toBeUndefined();
}

/** A managed account created through `POST /staff/accounts`, as the product creates them. */
async function managedAccount() {
  const owner = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  await seedStaffPlan(infra, owner.orgId, null);
  const username = `m.${randomUUID().slice(0, 8)}`;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/staff/accounts",
    headers: owner.headers,
    payload: { displayName: "Managed", username, password: PASSWORD, role: "groomer", branchIds: owner.branchIds },
  });
  if (res.statusCode !== 201) throw new Error(`create failed: ${res.body}`);
  const userId = (res.json() as { userId: string }).userId;
  return { userId, username, placeholder: `${userId}@managed.invalid` };
}

describe("managed accounts log in by username only", () => {
  it("refuses the placeholder email with the right password like a wrong password: no session, no cookie, password hashed", async () => {
    const m = await managedAccount();
    const hash = vi.spyOn((await auth.$context).password, "hash");
    try {
      for (const identifier of [m.placeholder, m.placeholder.toUpperCase(), `${m.userId}@Managed.Invalid`]) denied(await login(identifier));
      expect(hash).toHaveBeenCalledTimes(3);
      expect(hash).toHaveBeenCalledWith(PASSWORD);
    } finally {
      hash.mockRestore();
    }
    const wrong = await login(m.placeholder, "wrong-password");
    denied(wrong);
    expect((await login(m.placeholder)).json()).toEqual(wrong.json());
    expect(await sessions(m.userId)).toEqual([]);
  });

  it("counts each refusal as a failure: the sixth attempt from one address is RATE_LIMITED", async () => {
    const m = await managedAccount();
    const address = nextIp();
    for (let n = 0; n < 5; n++) denied(await login(m.placeholder, PASSWORD, address));
    const blocked = await login(m.placeholder, PASSWORD, address);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(await sessions(m.userId)).toEqual([]);
  });

  it("still logs the same account in by username (then PASSWORD_CHANGE_REQUIRED as usual)", async () => {
    const m = await managedAccount();
    denied(await login(m.placeholder));
    const good = await login(m.username.toUpperCase());
    expect(good.statusCode, good.body).toBe(200);
    expect(good.json()).toEqual({ twoFactorRequired: false, mustChangePassword: true });
    expect(await sessions(m.userId)).toHaveLength(1);
  });

  it("leaves real-email accounts unchanged: verified logs in by email and username, unverified is refused", async () => {
    const id = randomUUID();
    const email = `${id}@example.com`;
    const username = `r-${id.slice(0, 8)}`;
    const signed = await auth.api.signUpEmail({ body: { email, username, password: PASSWORD, name: "Real" } });
    for (const identifier of [email, username]) denied(await login(identifier));
    await infra.platformDb.$client.query('update "user" set email_verified = true where id = $1', [signed.user.id]);
    for (const identifier of [email, email.toUpperCase(), username]) expect((await login(identifier)).statusCode, identifier).toBe(200);
  });
});
