import { randomUUID } from "node:crypto";
import { membership, organization, transactionQuery, withTenant } from "@app/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AUTH, type Auth, BACKGROUND, type BackgroundWork } from "../../src/modules/identity";
import { EMAIL_SENDER, type FakeEmailSender } from "../../src/modules/notification/email";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
let app: NestFastifyApplication;
let auth: Auth;
let mail: FakeEmailSender;
const PASSWORD = "correct-horse-1";
let ip = 0;
const nextIp = () => `10.36.0.${++ip}`;
const sql = (q: string, values: unknown[] = []) => infra.platformDb.$client.query(q, values);
const post = (path: string, payload: object, remoteAddress = nextIp()) =>
  app.inject({ method: "POST", url: `/api/v1/auth/${path}`, payload, remoteAddress });
const login = (identifier: string, password = PASSWORD, remoteAddress = nextIp()) => post("login", { identifier, password }, remoteAddress);
async function fixture(options: { verified?: boolean; managed?: boolean; suffix?: boolean } = {}) {
  const id = randomUUID();
  const email = `${id}@${options.suffix ? "managed.invalid" : "example.com"}`;
  const username = `u-${id.slice(0, 8)}`;
  const signed = await auth.api.signUpEmail({ body: { email, username, password: PASSWORD, name: "Login policy" } });
  // Default is deliberately legacy/unverified: only explicit positive fixtures have verified email.
  if (options.verified) await sql('UPDATE "user" SET email_verified = true WHERE id = $1', [signed.user.id]);
  const orgId = randomUUID();
  if (options.managed) {
    await withTenant(infra.runtimeDb, orgId, async (tx) => {
      await tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Managed login" });
      await tx.insert(membership).values({ orgId, userId: signed.user.id, role: "groomer", displayName: "Managed" });
    });
    await sql('UPDATE "user" SET is_managed = true, managed_by_org_id = $1, must_change_password = true WHERE id = $2', [
      orgId,
      signed.user.id,
    ]);
  }
  return { id: signed.user.id, email, username, orgId };
}
const identity = (id: string) => infra.platformDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) });
const sessions = (id: string) => infra.platformDb.query.session.findMany({ where: (s, { eq }) => eq(s.userId, id) });
function denied(res: { statusCode: number; headers: Record<string, unknown>; json(): unknown }) {
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  expect(res.headers["set-cookie"]).toBeUndefined();
}
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  auth = app.get<Auth>(AUTH);
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
}, 180_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await infra?.stop();
});

it.each(["email", "username"] as const)(
  "legacy unverified %s login consumes quota, does password work, and never attempts a session or sends mail",
  async (mode) => {
    const f = await fixture();
    const address = nextIp();
    const before = mail.sent.length;
    const ctx = await auth.$context;
    const hash = vi.spyOn(ctx.password, "hash");
    // A nontransactional sequence records even transient session INSERT attempts that are later deleted/rolled back.
    await infra.db.migratorDb.$client.query("CREATE SEQUENCE test_login_session_attempts");
    await infra.db.migratorDb.$client.query(`CREATE FUNCTION test_login_session_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM nextval('test_login_session_attempts'); RETURN NEW; END $$`);
    await infra.db.migratorDb.$client.query(
      "CREATE TRIGGER test_login_session_attempt BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION test_login_session_attempt()",
    );
    try {
      const responses = [];
      for (let n = 0; n < 5; n++) responses.push(await login(f[mode], PASSWORD, address));
      const attempts = await infra.db.migratorDb.$client.query("SELECT is_called FROM test_login_session_attempts");
      expect(attempts.rows).toEqual([{ is_called: false }]);
      for (const response of responses) denied(response);
      expect(hash).toHaveBeenCalledTimes(5);
      expect(hash).toHaveBeenCalledWith(PASSWORD);
      const blocked = await login(f[mode], PASSWORD, address);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
      expect(blocked.headers["set-cookie"]).toBeUndefined();
      expect(await sessions(f.id)).toEqual([]);
      expect(mail.sent).toHaveLength(before);
      expect((await identity(f.id))!.emailVerified).toBe(false);
    } finally {
      hash.mockRestore();
      await infra.db.migratorDb.$client.query("DROP TRIGGER test_login_session_attempt ON session");
      await infra.db.migratorDb.$client.query("DROP FUNCTION test_login_session_attempt()");
      await infra.db.migratorDb.$client.query("DROP SEQUENCE test_login_session_attempts");
    }
  },
);

it.each(["email", "username"] as const)(
  "explicitly verified %s accepts correct credentials, rejects wrong passwords and resets the failure quota",
  async (mode) => {
    const f = await fixture({ verified: true });
    const address = nextIp();
    const before = mail.sent.length;
    for (let n = 0; n < 4; n++) denied(await login(f[mode], "wrong-password", address));
    expect(await sessions(f.id)).toEqual([]);
    const good = await login(f[mode], PASSWORD, address);
    expect(good.statusCode).toBe(200);
    expect(good.headers["set-cookie"]).toBeDefined();
    expect(await sessions(f.id)).toHaveLength(1);
    for (let n = 0; n < 4; n++) denied(await login(f[mode], "wrong-password", address));
    expect((await login(f[mode], PASSWORD, address)).statusCode).toBe(200);
    expect(mail.sent).toHaveLength(before);
  },
);

it.each(["email", "username"] as const)("unverified %s with a wrong password is a normal counted failure", async (mode) => {
  const f = await fixture();
  const address = nextIp();
  for (let n = 0; n < 5; n++) denied(await login(f[mode], "wrong-password", address));
  expect((await login(f[mode], PASSWORD, address)).statusCode).toBe(429);
  expect(await sessions(f.id)).toEqual([]);
});

it("managed.invalid alone grants no exemption in either login mode", async () => {
  const f = await fixture({ suffix: true });
  const before = mail.sent.length;
  for (const identifier of [f.email, f.username]) denied(await login(identifier));
  expect(await sessions(f.id)).toEqual([]);
  expect(mail.sent).toHaveLength(before);
});

it("isManaged alone grants the verification exemption, retaining must-change and active owning membership in both modes", async () => {
  // Real-looking address proves the exemption depends on the flag, not the suffix.
  const f = await fixture({ managed: true });
  const before = mail.sent.length;
  for (const identifier of [f.email, f.username]) {
    const good = await login(identifier);
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ twoFactorRequired: false, mustChangePassword: true });
    denied(await login(identifier, "wrong-password"));
  }
  await withTenant(infra.runtimeDb, f.orgId, (tx) =>
    transactionQuery(tx)`UPDATE membership SET status = 'removed' WHERE user_id = ${f.id}`,
  );
  const current = await sessions(f.id);
  for (const identifier of [f.email, f.username]) denied(await login(identifier));
  expect(await sessions(f.id)).toEqual(current);
  expect((await identity(f.id))!.emailVerified).toBe(false);
  expect(mail.sent).toHaveLength(before);
});

it.each(["email", "username"] as const)(
  "legacy %s login recovers through HTTP resend and verification without an intermediate session",
  async (mode) => {
    const f = await fixture();
    denied(await login(f[mode]));
    expect((await post("email/verification/resend", { email: f.email })).statusCode).toBe(204);
    const message = mail.sent.filter((m) => m.to === f.email).at(-1)!;
    const token = new URLSearchParams(new URL(message.text.match(/http[^\s]+/)![0]).hash.slice(1)).get("token")!;
    const verified = await post("email/verify", { token });
    expect(verified.statusCode).toBe(204);
    expect(verified.headers["set-cookie"]).toBeUndefined();
    expect(await sessions(f.id)).toEqual([]);
    expect((await identity(f.id))!.emailVerified).toBe(true);
    expect((await login(f[mode])).statusCode).toBe(200);
  },
);

it("password reset changes credentials but never verifies legacy email or enables either login mode", async () => {
  const f = await fixture();
  expect((await post("password/forgot", { email: f.email })).statusCode).toBe(204);
  await app.get<BackgroundWork>(BACKGROUND).idle();
  const message = mail.sent.filter((m) => m.to === f.email).at(-1)!;
  const token = new URL(message.text.match(/http[^\s]+/)![0]).searchParams.get("token")!;
  const reset = await post("password/reset", { token, password: "recovered-password-2" });
  expect(reset.statusCode).toBe(204);
  expect(reset.headers["set-cookie"]).toBeUndefined();
  expect((await identity(f.id))!.emailVerified).toBe(false);
  for (const identifier of [f.email, f.username]) denied(await login(identifier, "recovered-password-2"));
  expect(await sessions(f.id)).toEqual([]);
});
