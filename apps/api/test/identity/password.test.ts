import { randomUUID } from "node:crypto";
import { organization, withTenant } from "@app/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AUTH, type Auth, BACKGROUND, type BackgroundWork } from "../../src/modules/identity";
import { EMAIL_SENDER, FakeEmailSender } from "../../src/modules/notification/email";
import { bootTestApp, testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
let app: NestFastifyApplication;
let auth: Auth;
let mail: FakeEmailSender;
let background: BackgroundWork;
const logs: string[] = [];
const PASSWORD = "correct-horse-1";
const NEW_PASSWORD = "battery-staple-2";
const ORG = randomUUID();
let ip = 0;
/** Every test uses its own client IP so rate-limit counters never leak between tests. */
const nextIp = () => `10.20.${Math.floor(++ip / 250)}.${ip % 250}`;

/** Direct SQL on the platform connection for fixture tweaks (no drizzle-orm import needed in apps/api). */
const sql = (text: string, values: unknown[]) => infra.platformDb.$client.query(text, values);

async function signUp(email: string, username?: string) {
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: email.split("@")[0] ?? "x", ...(username ? { username } : {}) },
  });
  return res.user;
}

const post = (url: string, payload: unknown, headers: Record<string, string> = {}, remoteAddress = nextIp()) =>
  app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, headers, remoteAddress });
/** forgot answers before the email is sent (background) — wait for it so the outbox of the fake can be checked. */
async function forgot(email: string, remoteAddress = nextIp()) {
  const res = await post("/auth/password/forgot", { email }, {}, remoteAddress);
  await background.idle();
  return res;
}
const login = (identifier: string, password = PASSWORD) => post("/auth/login", { identifier, password });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((res.headers["set-cookie"] as string | string[] | undefined) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
const me = (cookie: string) => app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });

/** The reset token from the last email sent to `to` — taken from the link `${APP_ORIGIN}/reset-password?token=…`. */
function tokenFromMail(to: string): string {
  const msg = mail.sent.filter((m) => m.to === to).at(-1);
  if (!msg) throw new Error(`no mail to ${to}`);
  const link = msg.text.match(/(\S+\/reset-password\?token=\S+)/)?.[1] as string;
  expect(link.startsWith(`${testConfig.APP_ORIGIN}/reset-password?token=`)).toBe(true);
  return new URL(link).searchParams.get("token") as string;
}

beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (l) => logs.push(l) }, infra);
  auth = app.get<Auth>(AUTH);
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
  background = app.get<BackgroundWork>(BACKGROUND);
  await withTenant(infra.runtimeDb, ORG, (tx) => tx.insert(organization).values({ id: ORG, slug: "shop-pw", displayName: "shop" }));
}, 180_000);

afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EmailSender in tests", () => {
  it("is the in-memory fake (NODE_ENV=test)", () => {
    expect(mail).toBeInstanceOf(FakeEmailSender);
  });
});

describe("auth.passwordForgot", () => {
  it("existing email user → 204 and one email with the reset link", async () => {
    await signUp("forgot@example.com");
    const before = mail.sent.length;
    const res = await forgot("Forgot@Example.com");
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.sent.at(-1)?.to).toBe("forgot@example.com");
    expect(tokenFromMail("forgot@example.com")).toMatch(/\S{16,}/);
  });

  it("unknown email → 204, no email", async () => {
    const before = mail.sent.length;
    const res = await forgot("nobody@example.com");
    expect(res.statusCode).toBe(204);
    expect(mail.sent.length).toBe(before);
  });

  it("managed account (F09) → 204, no email", async () => {
    const email = `${randomUUID()}@managed.invalid`;
    const u = await signUp(email, "managed.pw");
    await sql(`update "user" set is_managed = true, managed_by_org_id = $1 where id = $2`, [ORG, u.id]);
    const before = mail.sent.length;
    const res = await forgot(email);
    expect(res.statusCode).toBe(204);
    expect(mail.sent.length).toBe(before);
  });

  it("rate limit: 3 per hour per email + IP → 4th still 204 but no email; other IP unaffected (F11)", async () => {
    await signUp("limit@example.com");
    const addr = nextIp();
    const before = mail.sent.length;
    for (let i = 0; i < 3; i++) expect((await forgot("limit@example.com", addr)).statusCode).toBe(204);
    expect(mail.sent.length).toBe(before + 3);
    expect((await forgot("LIMIT@example.com", addr)).statusCode).toBe(204);
    expect(mail.sent.length).toBe(before + 3);
    expect((await forgot("limit@example.com", nextIp())).statusCode).toBe(204);
    expect(mail.sent.length).toBe(before + 4);
  });

  it("concurrent requests cannot exceed 3 emails per email + IP", async () => {
    await signUp("burst@example.com");
    const addr = nextIp();
    const before = mail.sent.length;
    const all = await Promise.all(Array.from({ length: 6 }, () => post("/auth/password/forgot", { email: "burst@example.com" }, {}, addr)));
    await background.idle();
    expect(all.every((r) => r.statusCode === 204)).toBe(true);
    expect(mail.sent.length).toBe(before + 3);
  });

  it("answers without waiting for the email, so timing does not reveal the account", async () => {
    await signUp("slowmail@example.com");
    mail.delayMs = 1500;
    try {
      const started = Date.now();
      const res = await post("/auth/password/forgot", { email: "slowmail@example.com" });
      expect(res.statusCode).toBe(204);
      expect(Date.now() - started).toBeLessThan(1000);
      await background.idle();
      expect(mail.sent.at(-1)?.to).toBe("slowmail@example.com");
    } finally {
      mail.delayMs = 0;
    }
  });

  it("invalid body → 400 VALIDATION_FAILED", async () => {
    const res = await post("/auth/password/forgot", { email: "not-an-email" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });
});

describe("auth.passwordReset", () => {
  it("valid token → 204, new password works, old one does not, every session revoked, one audit row", async () => {
    const u = await signUp("reset@example.com");
    const s1 = cookieOf(await login("reset@example.com"));
    const s2 = cookieOf(await login("reset@example.com"));
    expect((await me(s1)).statusCode).toBe(200);

    await forgot("reset@example.com");
    const res = await post("/auth/password/reset", { token: tokenFromMail("reset@example.com"), password: NEW_PASSWORD });
    expect(res.statusCode).toBe(204);

    expect((await me(s1)).statusCode).toBe(401);
    expect((await me(s2)).statusCode).toBe(401);
    expect((await login("reset@example.com", PASSWORD)).statusCode).toBe(401);
    expect((await login("reset@example.com", NEW_PASSWORD)).statusCode).toBe(200);

    const audit = await sql(`select action, entity_type, entity_id, actor_user_id, org_id from audit_log where entity_id = $1`, [u.id]);
    expect(audit.rows).toEqual([
      { action: "auth.password_reset", entity_type: "user", entity_id: u.id, actor_user_id: u.id, org_id: null },
    ]);
  });

  it("a used token → 400 VALIDATION_FAILED with details.fields.token", async () => {
    await signUp("reuse@example.com");
    await forgot("reuse@example.com");
    const token = tokenFromMail("reuse@example.com");
    expect((await post("/auth/password/reset", { token, password: NEW_PASSWORD })).statusCode).toBe(204);
    const again = await post("/auth/password/reset", { token, password: "another-pass-3" });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe("VALIDATION_FAILED");
    expect(again.json().error.details.fields.token).toBeDefined();
  });

  it("an expired token (older than 1 hour) → 400 VALIDATION_FAILED with details.fields.token", async () => {
    await signUp("expired@example.com");
    await forgot("expired@example.com");
    const token = tokenFromMail("expired@example.com");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    const res = await post("/auth/password/reset", { token, password: NEW_PASSWORD });
    vi.useRealTimers();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields.token).toBeDefined();
    expect((await login("expired@example.com", PASSWORD)).statusCode).toBe(200);
  });

  it("is atomic: if the audit insert fails, password, sessions and token stay unchanged", async () => {
    await signUp("atomic@example.com");
    const cookie = cookieOf(await login("atomic@example.com"));
    await forgot("atomic@example.com");
    const token = tokenFromMail("atomic@example.com");
    const admin = (q: string) => infra.db.migratorDb.$client.query(q);
    await admin(`create function test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
    await admin(`create trigger test_fail_audit before insert on audit_log for each row execute function test_fail_audit()`);
    try {
      expect((await post("/auth/password/reset", { token, password: NEW_PASSWORD })).statusCode).toBe(500);
    } finally {
      await admin("drop trigger test_fail_audit on audit_log");
      await admin("drop function test_fail_audit()");
    }
    expect((await me(cookie)).statusCode).toBe(200);
    expect((await login("atomic@example.com", PASSWORD)).statusCode).toBe(200);
    expect((await post("/auth/password/reset", { token, password: NEW_PASSWORD })).statusCode).toBe(204);
  });

  it("a wrong token → 400 with details.fields.token", async () => {
    const res = await post("/auth/password/reset", { token: "not-a-real-token", password: NEW_PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields.token).toBeDefined();
  });

  it("password policy (10–128) → 400 VALIDATION_FAILED on password", async () => {
    const short = await post("/auth/password/reset", { token: "x", password: "short" });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.details.fields.password).toBeDefined();
    const long = await post("/auth/password/reset", { token: "x", password: "a".repeat(129) });
    expect(long.json().error.details.fields.password).toBeDefined();
  });
});

describe("auth.passwordChange", () => {
  it("requires a session", async () => {
    const res = await post("/auth/password/change", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(401);
  });

  it("wrong current password → 401 UNAUTHENTICATED; password unchanged", async () => {
    await signUp("wrong@example.com");
    const cookie = cookieOf(await login("wrong@example.com"));
    const res = await post("/auth/password/change", { currentPassword: "not-my-password", newPassword: NEW_PASSWORD }, { cookie });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    expect((await login("wrong@example.com", PASSWORD)).statusCode).toBe(200);
  });

  it("success → 204, mustChangePassword false, other sessions revoked, current session kept", async () => {
    const u = await signUp("change@example.com", "change.me");
    await sql(`update "user" set must_change_password = true where id = $1`, [u.id]);
    const current = cookieOf(await login("change.me"));
    const other = cookieOf(await login("change.me"));

    const res = await post("/auth/password/change", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { cookie: current });
    expect(res.statusCode).toBe(204);

    const mine = await me(current);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().user.mustChangePassword).toBe(false);
    expect((await me(other)).statusCode).toBe(401);
    expect((await login("change.me", NEW_PASSWORD)).json().mustChangePassword).toBe(false);
  });

  it("new password policy → 400 VALIDATION_FAILED on newPassword", async () => {
    await signUp("policy@example.com");
    const cookie = cookieOf(await login("policy@example.com"));
    const res = await post("/auth/password/change", { currentPassword: PASSWORD, newPassword: "short" }, { cookie });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields.newPassword).toBeDefined();
  });
});

describe("logs", () => {
  it("never contain a reset token or a password", () => {
    const all = logs.join("\n");
    const tokens = mail.sent.map((m) => m.text.match(/token=(\S+)/)?.[1]).filter(Boolean) as string[];
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(all).not.toContain(t);
    expect(all).not.toContain(NEW_PASSWORD);
    expect(all).not.toContain(PASSWORD);
  });
});
