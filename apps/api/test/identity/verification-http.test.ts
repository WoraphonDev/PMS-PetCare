import { createHash, randomUUID } from "node:crypto";
import { AuthEmailVerificationResendRequest, AuthEmailVerifyRequest } from "@app/contracts";
import { createDb, organization, transactionQuery, user, withTenant } from "@app/db";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createEmailVerificationToken } from "better-auth/api";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  AUTH,
  type Auth,
  captureSignupVerification,
  captureVerificationAfterCommit,
  createEmailVerificationRepository,
} from "../../src/modules/identity";
import { createAuth } from "../../src/modules/identity/auth";
import { EMAIL_SENDER, FakeEmailSender } from "../../src/modules/notification/email";
import { bootTestApp, testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
let app: NestFastifyApplication;
let mail: FakeEmailSender;
const logs: string[] = [];
const repo = createEmailVerificationRepository(testConfig.BETTER_AUTH_SECRET);
const now = () => new Date();
const ns = (id: string) => `pms:email-verify:v1:${id}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
let ip = 0;
const nextIp = () => `10.35.${Math.floor(++ip / 250)}.${ip % 250}`;
const post = (path: string, payload: object, remoteAddress = nextIp(), headers = {}) =>
  app.inject({ method: "POST", url: `/api/v1/auth/email/${path}`, payload, remoteAddress, headers });
const resend = (email: string, address = nextIp()) => post("verification/resend", { email }, address);
const verify = (token: string, extra = {}, headers = {}) => post("verify", { token, ...extra }, nextIp(), headers);
const states = (id: string) => infra.runtimeDb.query.verification.findMany({ where: (v, { eq }) => eq(v.identifier, ns(id)) });
const identity = (id: string) => infra.runtimeDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) });
const issue = (id: string, time = now()) => infra.runtimeDb.transaction((tx) => repo.issueEmailVerification(tx, id, time));
async function seed(options: { emailVerified?: boolean; isManaged?: boolean; email?: string } = {}) {
  const id = randomUUID();
  let orgId: string | undefined;
  if (options.isManaged) {
    orgId = randomUUID();
    await withTenant(infra.runtimeDb, orgId, (tx) => tx.insert(organization).values({ id: orgId!, slug: orgId!, displayName: "Managed" }));
  }
  const email = options.email ?? `${id}@example.com`;
  await infra.runtimeDb.insert(user).values({ id, name: "Verification HTTP", ...options, email, managedByOrgId: orgId });
  return { id, email };
}
function empty(res: { statusCode: number; body: string; headers: Record<string, unknown> }) {
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe("");
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(res.headers.location).toBeUndefined();
}
function invalid(res: { statusCode: number; json(): unknown; headers: Record<string, unknown> }) {
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { fields: { token: expect.any(Array) } } } });
  expect(res.headers["set-cookie"]).toBeUndefined();
}
function tokenFromMail(email: string) {
  const message = mail.sent.filter((m) => m.to === email).at(-1)!;
  const link = new URL(message.text.match(/http[^\s]+/)![0]);
  expect(link.origin).toBe(testConfig.APP_ORIGIN);
  expect(link.pathname).toBe("/verify-email");
  expect(link.search).toBe("");
  return new URLSearchParams(link.hash.slice(1)).get("token")!;
}
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

it("exports field contracts, normalizes email before validation, and strips callback inputs", () => {
  expect(AuthEmailVerificationResendRequest.parse({ email: "  Legacy@Example.COM  ", callbackURL: "https://evil.invalid" })).toEqual({
    email: "legacy@example.com",
  });
  expect(AuthEmailVerifyRequest.parse({ token: "signed", callbackURL: "https://evil.invalid" })).toEqual({ token: "signed" });
  for (const token of [undefined, null, 1, "", {}]) expect(AuthEmailVerifyRequest.safeParse({ token }).success).toBe(false);
  for (const email of [undefined, null, 1, "bad", `${"a".repeat(255)}@example.com`])
    expect(AuthEmailVerificationResendRequest.safeParse({ email }).success).toBe(false);
});

it("resends a fragment link, verifies only its owner once and creates no session/body/cookie", async () => {
  const a = await seed();
  const b = await seed();
  const other = (await issue(b.id))!;
  empty(await resend(`  ${a.email.toUpperCase()}  `));
  const token = tokenFromMail(a.email);
  expect(token).toBeTruthy();
  expect(JSON.stringify(await states(a.id))).not.toContain(token);
  empty(await verify(token, { callbackURL: "https://evil.invalid/?token=stolen", updateTo: b.email, requestType: "change-email" }));
  expect((await identity(a.id))!.emailVerified).toBe(true);
  expect((await identity(b.id))!.emailVerified).toBe(false);
  expect(await states(b.id)).toHaveLength(1);
  invalid(await verify(token));
  empty(await verify(other));
  expect(await infra.runtimeDb.query.session.findMany()).toEqual([]);
});

it("returns token field errors for malformed, replaced, expired, native, reset and 2FA purposes", async () => {
  const a = await seed();
  const first = (await issue(a.id))!;
  await issue(a.id);
  for (const token of [first, "a.b.c", "unsigned", "reset-password:secret", "two-factor:secret"]) invalid(await verify(token));
  const expired = (await issue(a.id, new Date(now().getTime() - 86400000)))!;
  invalid(await verify(expired));
  for (const extra of [
    {},
    { purpose: "password-reset" },
    { purpose: "two-factor" },
    { purpose: "email-verify", version: 1, nonce: randomUUID(), updateTo: a.email },
  ]) {
    const token = await createEmailVerificationToken(testConfig.BETTER_AUTH_SECRET, a.email, undefined, 86400, extra);
    await infra.runtimeDb.$client.query("UPDATE verification SET value = $1 WHERE identifier = $2", [
      JSON.stringify({ purpose: "email-verify", version: 1, digest: hash(token) }),
      ns(a.id),
    ]);
    invalid(await verify(token));
  }
  for (const payload of [{}, { token: null }, { token: 1 }, { token: "" }]) invalid(await post("verify", payload));
  expect((await identity(a.id))!.emailVerified).toBe(false);
  expect(await infra.runtimeDb.query.session.findMany()).toEqual([]);
});

it("HTTP signed expiry and concurrent reuse fail on token; corrupt state is INTERNAL without sensitive output", async () => {
  const a = await seed();
  const expired = await createEmailVerificationToken(testConfig.BETTER_AUTH_SECRET, a.email, undefined, -1, {
    purpose: "email-verify",
    version: 1,
    nonce: randomUUID(),
  });
  await issue(a.id);
  await infra.runtimeDb.$client.query("UPDATE verification SET value = $1 WHERE identifier = $2", [
    JSON.stringify({ purpose: "email-verify", version: 1, digest: hash(expired) }),
    ns(a.id),
  ]);
  invalid(await verify(expired));
  const token = (await issue(a.id))!;
  const responses = await Promise.all(Array.from({ length: 5 }, () => verify(token)));
  expect(responses.filter((r) => r.statusCode === 204)).toHaveLength(1);
  for (const response of responses) if (response.statusCode !== 204) invalid(response);
  const b = await seed();
  const corrupt = (await issue(b.id))!;
  await infra.runtimeDb.$client.query("UPDATE verification SET value = $1 WHERE identifier = $2", [corrupt, ns(b.id)]);
  const diagnostic = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  const response = await verify(corrupt);
  const categories = [...diagnostic.mock.calls];
  diagnostic.mockRestore();
  expect(categories).toEqual([["verification-state-invariant"]]);
  expect(response.statusCode).toBe(500);
  expect(response.json()).toMatchObject({ error: { code: "INTERNAL" } });
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(response.body).not.toContain(corrupt);
  expect(response.body).not.toContain(b.email);
  expect((await identity(b.id))!.emailVerified).toBe(false);
  const malformed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/email/verify",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
});

it("counts unknown, verified, managed and managed.invalid identically without state or mail; invalid schema is not counted", async () => {
  const recipients = [
    { id: randomUUID(), email: `${randomUUID()}@example.com` },
    await seed({ emailVerified: true }),
    await seed({ isManaged: true }),
    await seed({ email: `${randomUUID()}@managed.invalid` }),
    await seed({ email: `${randomUUID()}@Managed.INVALID` }),
    await seed({ isManaged: true, email: `${randomUUID()}@managed.invalid` }),
  ];
  const before = mail.sent.length;
  for (const recipient of recipients) {
    const address = nextIp();
    for (let n = 0; n < 4; n++) empty(await resend(` ${recipient.email.toUpperCase()} `, address));
    expect(await infra.valkey.get(`resend-email-attempt:${encodeURIComponent(recipient.email.toLowerCase())}`)).toBe("4");
    expect(await infra.valkey.get(`resend-ip-attempt:${encodeURIComponent(address)}`)).toBe("4");
    expect(await states(recipient.id)).toEqual([]);
  }
  const address = nextIp();
  for (const email of ["bad", "", 1, null]) {
    const res = await post("verification/resend", { email }, address);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { fields: { email: expect.any(Array) } } } });
  }
  expect(await infra.valkey.get(`resend-ip-attempt:${address}`)).toBeNull();
  expect(mail.sent).toHaveLength(before);
});

it("atomic concurrent quota permits three rotations and only the final digest verifies", async () => {
  const a = await seed();
  const address = nextIp();
  const before = mail.sent.length;
  for (const res of await Promise.all(Array.from({ length: 8 }, () => resend(a.email, address)))) empty(res);
  const sent = mail.sent.slice(before);
  expect(sent).toHaveLength(3);
  const current = JSON.parse((await states(a.id))[0]!.value).digest;
  const tokens = sent.map((message) => new URLSearchParams(new URL(message.text.match(/http[^\s]+/)![0]).hash.slice(1)).get("token")!);
  expect(new Set(tokens).size).toBe(3);
  for (const token of tokens) if (hash(token) !== current) invalid(await verify(token));
  empty(await verify(tokens.find((token) => hash(token) === current)!));
  expect(await infra.valkey.get(`resend-email-attempt:${encodeURIComponent(a.email)}`)).toBe("8");
  expect(await infra.valkey.get(`resend-ip-attempt:${address}`)).toBe("8");
});

it("IP quota suppresses an eligible recipient after ten unknown recipients but still increments email quota", async () => {
  const address = nextIp();
  for (let n = 0; n < 10; n++) empty(await resend(`${randomUUID()}@example.com`, address));
  const a = await seed();
  const old = (await issue(a.id))!;
  const before = mail.sent.length;
  empty(await resend(a.email, address));
  expect(JSON.parse((await states(a.id))[0]!.value).digest).toBe(hash(old));
  expect(mail.sent).toHaveLength(before);
  expect(await infra.valkey.get(`resend-email-attempt:${encodeURIComponent(a.email)}`)).toBe("1");
  expect(await infra.valkey.get(`resend-ip-attempt:${address}`)).toBe("11");
});

it("provider failure retains committed state and quota and reports only a sanitized category", async () => {
  const a = await seed();
  const old = (await issue(a.id))!;
  const diagnostic = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  mail.failWith = new Error(`${a.email} ${old} provider-secret`);
  try {
    empty(await resend(a.email));
    expect(JSON.parse((await states(a.id))[0]!.value).digest).not.toBe(hash(old));
    invalid(await verify(old));
    expect(await infra.valkey.get(`resend-email-attempt:${encodeURIComponent(a.email)}`)).toBe("1");
    expect(diagnostic.mock.calls).toEqual([["verification-email-send-failed"]]);
  } finally {
    mail.failWith = null;
    diagnostic.mockRestore();
  }
});

it("verification and resend ignore supplied must-change session cookies and malicious callback inputs", async () => {
  const signed = await app
    .get<Auth>(AUTH)
    .api.signUpEmail({ body: { email: `${randomUUID()}@example.com`, name: "Cookie", password: "correct-horse-1" } });
  // This fixture supplies a real authenticated cookie; recovery recipients below remain unverified.
  await infra.runtimeDb.$client.query('UPDATE "user" SET email_verified = true, must_change_password = true WHERE id = $1', [
    signed.user.id,
  ]);
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { identifier: signed.user.email, password: "correct-horse-1" },
  });
  expect(login.statusCode).toBe(200);
  const cookie = ([] as string[])
    .concat(login.headers["set-cookie"] ?? [])
    .map((s) => s.split(";")[0])
    .join("; ");
  const sessions = await infra.runtimeDb.query.session.findMany();
  const a = await seed();
  empty(
    await post("verification/resend?callbackURL=https://evil.invalid", { email: a.email, callbackURL: "https://evil.invalid" }, nextIp(), {
      cookie,
    }),
  );
  empty(await verify(tokenFromMail(a.email), { callbackURL: "javascript:alert(1)" }, { cookie }));
  expect(await infra.runtimeDb.query.session.findMany()).toEqual(sessions);
});

it("signup capture is transaction-bound, returns no token, waits for commit, and isolates simultaneous collectors", async () => {
  const sender = new FakeEmailSender();
  const a = await seed();
  const b = await seed();
  const ready = await Promise.all(
    [a, b].map((u) =>
      captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
        expect(await captureSignupVerification(tx, u.id, now(), testConfig, capture)).toBeUndefined();
        expect(await states(u.id)).toEqual([]);
        expect(sender.sent).toEqual([]);
      }),
    ),
  );
  expect(sender.sent).toEqual([]);
  await ready[1]!.dispatch();
  expect(sender.sent.map((m) => m.to)).toEqual([b.email]);
  await Promise.all([ready[0]!.dispatch(), ready[0]!.dispatch()]);
  expect(sender.sent.map((m) => m.to)).toEqual([b.email, a.email]);
  const c = await seed();
  await expect(
    captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
      await captureSignupVerification(tx, c.id, now(), testConfig, capture);
      throw new Error("rollback capture");
    }),
  ).rejects.toThrow("rollback capture");
  expect(await states(c.id)).toEqual([]);
  expect(sender.sent).toHaveLength(2);
});

it("signup capture sanitizes real SQL failures before the native callback boundary", async () => {
  const sender = new FakeEmailSender();
  const a = await seed();
  const result = await captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
    await transactionQuery(tx)`SET TRANSACTION READ ONLY`;
    await captureSignupVerification(tx, a.id, now(), testConfig, capture);
  }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(result).toMatchObject({ code: "INTERNAL", message: "INTERNAL" });
  expect(result).not.toHaveProperty("cause");
  expect(String(result)).not.toContain(a.email);
  expect(sender.sent).toEqual([]);
  expect(await states(a.id)).toEqual([]);
});

it("transaction-bound Better Auth signup callback captures approved state with auto-login disabled", async () => {
  const sender = new FakeEmailSender();
  const email = `${randomUUID()}@example.com`;
  const ready = await captureVerificationAfterCommit(infra.runtimeDb, sender, async (tx, capture) => {
    const auth = createAuth(testConfig, tx, sender, (id) => captureSignupVerification(tx, id, now(), testConfig, capture));
    const result = await auth.api.signUpEmail({ body: { email, name: "Signup", password: "correct-horse-1" } });
    expect(result.token).toBeNull();
    expect(sender.sent).toEqual([]);
    expect(await tx.query.verification.findMany({ where: (v, { eq }) => eq(v.identifier, ns(result.user.id)) })).toHaveLength(1);
    return result.user.id;
  });
  expect(await states(ready.value)).toHaveLength(1);
  expect(sender.sent).toEqual([]);
  await ready.dispatch();
  expect(sender.sent.map((m) => m.to)).toEqual([email]);
  for (const path of ["/api/auth/verify-email", "/api/v1/auth/verify-email", "/api/v1/auth/signup"]) {
    expect((await app.inject({ method: "POST", url: path, payload: {} })).statusCode).toBe(404);
  }
});

it("HTTP logs, audit and analytics do not capture token/email/link/callback/provider data", async () => {
  const a = await seed();
  logs.length = 0;
  empty(await resend(a.email));
  const token = tokenFromMail(a.email);
  empty(await verify(token, { callbackURL: "https://evil.invalid/private-callback" }));
  invalid(await verify(token));
  const audit = await infra.platformDb.$client.query("SELECT * FROM audit_log");
  const serialized = JSON.stringify({ logs, audit: audit.rows });
  for (const secret of [a.email, token, "private-callback", "#token=", "provider-secret"]) expect(serialized).not.toContain(secret);
  expect(audit.rows).toEqual([]);
  expect(logs.join("")).toContain("auth/email/verify");
});

// Last: destroy only the disposable test connections, not application/host configuration.
it("Valkey outage suppresses rotation/send; DB outage returns sanitized INTERNAL even with supplied cookies", async () => {
  const a = await seed();
  const old = (await issue(a.id))!;
  const before = mail.sent.length;
  infra.valkey.disconnect();
  empty(await resend(a.email));
  expect(mail.sent).toHaveLength(before);
  expect(JSON.parse((await states(a.id))[0]!.value).digest).toBe(hash(old));
  await infra.valkey.connect();
  const failedDb = createDb(infra.db.runtimeUrl);
  const failedApp = await bootTestApp([], { write: (line) => logs.push(line) }, { ...infra, runtimeDb: failedDb });
  await failedDb.$client.end();
  const failedPost = (path: string, payload: object) =>
    failedApp.inject({
      method: "POST",
      url: `/api/v1/auth/email/${path}`,
      payload,
      headers: { cookie: "untrusted=supplied" },
      remoteAddress: nextIp(),
    });
  for (const response of [await failedPost("verify", { token: old }), await failedPost("verification/resend", { email: a.email })]) {
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(response.body).not.toContain(a.email);
    expect(response.body).not.toContain(old);
    expect(response.headers["set-cookie"]).toBeUndefined();
  }
  await failedApp.close();
  const serialized = logs.join("");
  expect(serialized).not.toContain(old);
  expect(serialized).not.toContain(a.email);
});
