import { createHmac, randomUUID } from "node:crypto";
import { membership, organization, withTenant } from "@app/db";
import { Controller, Get, Module, UseGuards } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { CLOCK, type Clock } from "../../src/common/context";
import { PlatformAdminGuard } from "../../src/common/platform-admin.guard";
import { AUTH, type Auth } from "../../src/modules/identity";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

@Controller("platform-probe")
@UseGuards(PlatformAdminGuard)
class PlatformProbe {
  @Get() get() {
    return { ok: true };
  }
}
@Module({ controllers: [PlatformProbe] })
class ProbeModule {}
let infra: TestInfra;
let app: NestFastifyApplication;
let auth: Auth;
const logs: string[] = [];
const PASSWORD = "correct-horse-1";
const now = new Date("2030-01-01T00:00:00Z");
const secrets: string[] = [];
// Each test chains several login/2FA HTTP calls with password hashing; CI runners take 4-5x longer than local (T-0013-02).
const MULTI_STEP_TIMEOUT_MS = 20_000;
let ip = 0;
const sql = (q: string, values: unknown[] = []) => infra.platformDb.$client.query(q, values);
const post = (path: string, body: object, cookie = "") =>
  app.inject({ method: "POST", url: `/api/v1/auth/${path}`, payload: body, headers: { cookie }, remoteAddress: `10.40.0.${++ip}` });
const cookies = (r: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((r.headers["set-cookie"] as string | string[]) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
const me = (cookie: string) => app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
const login = (email: string, cookie = "") => post("login", { identifier: email, password: PASSWORD }, cookie);

// Independent RFC 6238 generator; plugin Date is mocked, application audit uses injected CLOCK.
function totp(uri: string, at = new Date()) {
  const secret = new URL(uri).searchParams.get("secret") as string;
  const bits = [...secret.toUpperCase()].map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest.at(-1) as number) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
async function fixture(admin = false) {
  const email = `${randomUUID()}@example.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "2fa" } });
  // Enrollment/session regressions begin with an already verified real-email account.
  await sql('update "user" set email_verified = true where id = $1', [u.user.id]);
  if (admin) await sql('update "user" set is_platform_admin = true where id = $1', [u.user.id]);
  const cookie = cookies(await login(email));
  return { email, id: u.user.id, cookie };
}
async function setup(admin = false) {
  const f = await fixture(admin);
  const res = await post("2fa/enable", { password: PASSWORD }, f.cookie);
  expect(res.statusCode).toBe(200);
  const body = res.json<{ totpUri: string; backupCodes: string[] }>();
  expect(body.backupCodes).toHaveLength(10);
  secrets.push(new URL(body.totpUri).searchParams.get("secret") as string, ...body.backupCodes);
  return { ...f, ...body };
}
async function enabled(admin = false) {
  const f = await setup(admin);
  const r = await post("2fa/verify", { code: totp(f.totpUri) }, f.cookie);
  expect(r.statusCode).toBe(204);
  return { ...f, cookie: cookies(r) };
}
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([ProbeModule], { write: (line) => logs.push(line) }, infra);
  auth = app.get<Auth>(AUTH);
  vi.spyOn(app.get<Clock>(CLOCK), "now").mockImplementation(() => new Date("2029-12-31T12:00:00Z"));
}, 180_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await infra?.stop();
});
afterEach(() => vi.useRealTimers());
function mockTime(at = now) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

it(
  "enable returns only URI and ten distinct backup codes; activates only after first TOTP, audits once using CLOCK",
  async () => {
    mockTime();
    const f = await setup();
    expect(new Set(f.backupCodes).size).toBe(10);
    expect((await me(f.cookie)).json().user.twoFactorEnabled).toBe(false);
    expect((await sql("select * from audit_log where entity_id = $1", [f.id])).rows).toHaveLength(0);
    const other = cookies(await login(f.email));
    const r = await post("2fa/verify", { code: totp(f.totpUri) }, f.cookie);
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe("");
    const current = cookies(r);
    expect((await me(current)).json().user.twoFactorEnabled).toBe(true);
    expect((await me(other)).statusCode).toBe(401);
    expect((await post("2fa/verify", { code: totp(f.totpUri) }, current)).statusCode).toBe(204);
    const audit = (await sql("select * from audit_log where entity_id = $1", [f.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "auth.two_factor_enabled",
      actor_user_id: f.id,
      org_id: null,
      entity_type: "user",
      occurred_at: new Date("2029-12-31T12:00:00Z"),
    });
    for (const s of secrets) expect(JSON.stringify(audit)).not.toContain(s);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "email and username login require 2FA; pending credentials cannot call protected endpoints; TOTP completes login",
  async () => {
    mockTime();
    const f = await enabled();
    await sql('update "user" set username = $1 where id = $2', ["two.factor", f.id]);
    for (const identifier of [f.email, "two.factor"]) {
      const pending = await login(identifier);
      expect(pending.json()).toEqual({ twoFactorRequired: true, mustChangePassword: false });
      const cookie = cookies(pending);
      expect((await me(cookie)).statusCode).toBe(401);
      expect((await post("password/change", { currentPassword: PASSWORD, newPassword: "another-pass-2" }, cookie)).statusCode).toBe(401);
      expect((await post("2fa/enable", { password: PASSWORD }, cookie)).statusCode).toBe(401);
      const r = await post("2fa/verify", { code: totp(f.totpUri) }, cookie);
      expect(r.statusCode).toBe(204);
      expect((await me(cookies(r))).statusCode).toBe(200);
      expect(r.body).toBe("");
    }
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "backup codes work once, including concurrent redemption",
  async () => {
    mockTime();
    const f = await enabled();
    const a = cookies(await login(f.email));
    const b = cookies(await login(f.email));
    const all = await Promise.all([a, b].map((c) => post("2fa/verify", { code: f.backupCodes[0] }, c)));
    expect(all.map((r) => r.statusCode).sort()).toEqual([204, 401]);
    const r = await post("2fa/verify", { code: f.backupCodes[0] }, cookies(await login(f.email)));
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHENTICATED");
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "trusted device bypasses 2FA within 30 days, expires after 30 days and cannot be used for another account",
  async () => {
    mockTime();
    const f = await enabled();
    const pending = cookies(await login(f.email));
    const r = await post("2fa/verify", { code: totp(f.totpUri), trustDevice: true }, pending);
    expect(r.statusCode).toBe(204);
    const trust = cookies(r)
      .split("; ")
      .filter((c) => c.includes("trust_device"))
      .join("; ");
    expect(trust).not.toBe("");
    const second = await post("2fa/verify", { code: totp(f.totpUri), trustDevice: true }, cookies(await login(f.email)));
    expect(second.statusCode).toBe(204);
    const expiringTrust = cookies(second)
      .split("; ")
      .filter((c) => c.includes("trust_device"))
      .join("; ");
    vi.setSystemTime(now.getTime() + 29 * 86400_000);
    const within = await login(f.email, trust);
    expect(within.json().twoFactorRequired).toBe(false);
    expect((await me(cookies(within))).statusCode).toBe(200);
    const g = await enabled();
    expect((await login(g.email, trust)).json().twoFactorRequired).toBe(true);
    vi.setSystemTime(now.getTime() + 31 * 86400_000);
    expect((await login(f.email, expiringTrust)).json().twoFactorRequired).toBe(true);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "disable requires password AND code, rotates session, removes secret and audits once; admin cannot disable",
  async () => {
    mockTime();
    const f = await enabled();
    for (const body of [{ password: PASSWORD }, { code: totp(f.totpUri) }]) {
      const r = await post("2fa/disable", body, f.cookie);
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_FAILED");
    }
    for (const body of [
      { password: "wrong", code: f.backupCodes[0] },
      { password: PASSWORD, code: "invalid" },
    ]) {
      const r = await post("2fa/disable", body, f.cookie);
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe("UNAUTHENTICATED");
      expect((await me(f.cookie)).json().user.twoFactorEnabled).toBe(true);
    }
    const r = await post("2fa/disable", { password: PASSWORD, code: f.backupCodes[0] }, f.cookie);
    expect(r.statusCode).toBe(204);
    expect((await me(cookies(r))).json().user.twoFactorEnabled).toBe(false);
    expect((await sql("select * from two_factor where user_id = $1", [f.id])).rows).toHaveLength(0);
    const audit = (await sql("select * from audit_log where entity_id = $1 order by action", [f.id])).rows;
    expect(audit.map((a: { action: string }) => a.action)).toEqual(["auth.two_factor_disabled", "auth.two_factor_enabled"]);
    for (const s of secrets) expect(JSON.stringify(audit)).not.toContain(s);
    const admin = await enabled(true);
    const denied = await post("2fa/disable", { password: PASSWORD, code: totp(admin.totpUri) }, admin.cookie);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "TOTP disables 2FA and invalidates trusted devices when the user enrolls again",
  async () => {
    mockTime();
    const f = await enabled();
    const trusted = await post("2fa/verify", { code: totp(f.totpUri), trustDevice: true }, cookies(await login(f.email)));
    expect(trusted.statusCode).toBe(204);
    const oldTrust = cookies(trusted)
      .split("; ")
      .filter((c) => c.includes("trust_device"))
      .join("; ");
    const disabled = await post("2fa/disable", { password: PASSWORD, code: totp(f.totpUri) }, f.cookie);
    expect(disabled.statusCode).toBe(204);
    const setupAgain = await post("2fa/enable", { password: PASSWORD }, cookies(disabled));
    expect(setupAgain.statusCode).toBe(200);
    const uri = setupAgain.json().totpUri;
    secrets.push(new URL(uri).searchParams.get("secret") as string, ...setupAgain.json().backupCodes);
    const activated = await post("2fa/verify", { code: totp(uri) }, cookies(disabled));
    expect(activated.statusCode).toBe(204);
    expect((await login(f.email, oldTrust)).json().twoFactorRequired).toBe(true);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "session and body validation errors use the contract envelope",
  async () => {
    mockTime();
    for (const [path, body] of [
      ["enable", { password: PASSWORD }],
      ["verify", { code: "123456" }],
      ["disable", { password: PASSWORD, code: "123456" }],
    ] as const) {
      const r = await post(`2fa/${path}`, body);
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe("UNAUTHENTICATED");
    }
    const f = await fixture();
    for (const [path, body] of [
      ["enable", {}],
      ["verify", { code: "" }],
      ["verify", { code: "123456", trustDevice: "yes" }],
    ] as const) {
      const r = await post(`2fa/${path}`, body, f.cookie);
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_FAILED");
      expect(r.json().error.details.fields).toBeDefined();
    }
    expect((await post("2fa/enable", { password: "wrong" }, f.cookie)).statusCode).toBe(401);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "enable and disable roll back plugin data, session rotation and backup consumption when audit fails",
  async () => {
    mockTime();
    const f = await setup();
    const admin = (q: string) => infra.db.migratorDb.$client.query(q);
    async function failAudit(fn: () => Promise<void>) {
      await admin("create function test_fail_2fa_audit() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$");
      await admin("create trigger test_fail_2fa_audit before insert on audit_log for each row execute function test_fail_2fa_audit()");
      try {
        await fn();
      } finally {
        await admin("drop trigger test_fail_2fa_audit on audit_log");
        await admin("drop function test_fail_2fa_audit()");
      }
    }
    await failAudit(async () => {
      expect((await post("2fa/verify", { code: totp(f.totpUri) }, f.cookie)).statusCode).toBe(500);
      expect((await me(f.cookie)).json().user.twoFactorEnabled).toBe(false);
      expect((await sql("select verified from two_factor where user_id = $1", [f.id])).rows[0].verified).toBe(false);
    });
    const verified = await post("2fa/verify", { code: totp(f.totpUri) }, f.cookie);
    expect(verified.statusCode).toBe(204);
    const cookie = cookies(verified);
    await failAudit(async () => {
      expect((await post("2fa/disable", { password: PASSWORD, code: f.backupCodes[1] }, cookie)).statusCode).toBe(500);
      expect((await me(cookie)).json().user.twoFactorEnabled).toBe(true);
    });
    expect((await post("2fa/disable", { password: PASSWORD, code: f.backupCodes[1] }, cookie)).statusCode).toBe(204);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "platform guard requires an admin and proof on this session; password-only sessions never inherit enrollment",
  async () => {
    mockTime();
    const probe = (cookie: string) => app.inject({ method: "GET", url: "/api/v1/platform-probe", headers: { cookie } });
    expect((await probe("")).statusCode).toBe(401);
    const regular = await fixture();
    const denied = await probe(regular.cookie);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
    const admin = await setup(true);
    const before = await probe(admin.cookie);
    expect(before.statusCode).toBe(403);
    expect(before.json().error.code).toBe("TWO_FACTOR_REQUIRED");
    // Preserve a password-only session to model a concurrent login crossing activation.
    const original = await auth.api.getSession({ headers: new Headers({ cookie: admin.cookie }) });
    const row = (await sql("select * from session where id = $1", [original?.session.id])).rows[0];
    const verified = await post("2fa/verify", { code: totp(admin.totpUri) }, admin.cookie);
    expect(verified.statusCode).toBe(204);
    expect((await probe(cookies(verified))).statusCode).toBe(200);
    await sql("insert into session (id, token, user_id, expires_at, created_at, updated_at) values ($1,$2,$3,$4,$5,$6)", [
      row.id,
      row.token,
      row.user_id,
      row.expires_at,
      row.created_at,
      row.updated_at,
    ]);
    const stale = await probe(admin.cookie);
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error.code).toBe("TWO_FACTOR_REQUIRED");
    expect((await me(admin.cookie)).statusCode).toBe(401);
    expect((await post("2fa/verify", { code: totp(admin.totpUri) }, admin.cookie)).statusCode).toBe(401);
    const pending = cookies(await login(admin.email));
    expect((await probe(pending)).statusCode).toBe(401);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "wrong and expired verification credentials cannot activate 2FA or create a session",
  async () => {
    mockTime();
    const setupOnly = await setup();
    const wrong = await post("2fa/verify", { code: "invalid" }, setupOnly.cookie);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("UNAUTHENTICATED");
    expect((await me(setupOnly.cookie)).json().user.twoFactorEnabled).toBe(false);
    const f = await enabled();
    const pending = cookies(await login(f.email));
    const badTotp = await post("2fa/verify", { code: totp(f.totpUri, new Date(now.getTime() - 600_000)) }, pending);
    expect(badTotp.statusCode).toBe(401);
    expect(badTotp.json().error.code).toBe("UNAUTHENTICATED");
    vi.setSystemTime(now.getTime() + 11 * 60_000);
    const expired = await post("2fa/verify", { code: totp(f.totpUri) }, pending);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("UNAUTHENTICATED");
    expect((await me(pending)).statusCode).toBe(401);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it(
  "failed challenge attempts retain the plugin's rate limit across transactions",
  async () => {
    mockTime();
    const f = await enabled();
    const pending = cookies(await login(f.email));
    for (let n = 0; n < 5; n++) expect((await post("2fa/verify", { code: "invalid" }, pending)).statusCode).toBe(401);
    const blocked = await post("2fa/verify", { code: totp(f.totpUri) }, pending);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect((await me(pending)).statusCode).toBe(401);
  },
  MULTI_STEP_TIMEOUT_MS,
);
it("logs contain no TOTP secrets, backup codes or passwords", () => {
  expect(secrets.length).toBeGreaterThan(0);
  for (const s of [...secrets, PASSWORD]) expect(logs.join("\n")).not.toContain(s);
});

it(
  "unverified managed accounts retain must-change, 2FA and trusted-device behavior in both login modes",
  async () => {
    mockTime();
    const f = await enabled();
    const orgId = randomUUID();
    await withTenant(infra.runtimeDb, orgId, async (tx) => {
      await tx.insert(organization).values({ id: orgId, slug: orgId, displayName: "Managed 2FA" });
      await tx.insert(membership).values({ orgId, userId: f.id, role: "groomer", displayName: "Managed" });
    });
    await sql(
      'update "user" set is_managed = true, managed_by_org_id = $1, email_verified = false, must_change_password = true, username = $2 where id = $3',
      [orgId, "managed.2fa", f.id],
    );
    for (const identifier of [f.email, "managed.2fa"]) {
      const pending = await login(identifier);
      expect(pending.statusCode).toBe(200);
      expect(pending.json()).toEqual({ twoFactorRequired: true, mustChangePassword: true });
      expect((await me(cookies(pending))).statusCode).toBe(401);
      const verified = await post("2fa/verify", { code: totp(f.totpUri), trustDevice: true }, cookies(pending));
      expect(verified.statusCode).toBe(204);
      expect((await me(cookies(verified))).json().user.mustChangePassword).toBe(true);
      const trust = cookies(verified)
        .split("; ")
        .filter((c) => c.includes("trust_device"))
        .join("; ");
      expect(trust).not.toBe("");
      const trusted = await login(identifier, trust);
      expect(trusted.statusCode).toBe(200);
      expect(trusted.json()).toEqual({ twoFactorRequired: false, mustChangePassword: true });
      expect((await me(cookies(trusted))).statusCode).toBe(200);
    }
    expect((await sql('select email_verified from "user" where id = $1', [f.id])).rows).toEqual([{ email_verified: false }]);
  },
  MULTI_STEP_TIMEOUT_MS,
);

it(
  "a real-email account cannot use enrollment or a trusted device to bypass the verification gate",
  async () => {
    mockTime();
    const f = await enabled();
    const verified = await post("2fa/verify", { code: totp(f.totpUri), trustDevice: true }, cookies(await login(f.email)));
    expect(verified.statusCode).toBe(204);
    const trust = cookies(verified)
      .split("; ")
      .filter((c) => c.includes("trust_device"))
      .join("; ");
    expect(trust).not.toBe("");
    // Model a legacy unverified identity with existing F10 enrollment and a trusted device.
    await sql('update "user" set email_verified = false, username = $1 where id = $2', ["legacy.2fa", f.id]);
    const sessions = (await sql("select * from session where user_id = $1 order by id", [f.id])).rows;
    const states = (await sql("select * from verification order by id")).rows;
    for (const identifier of [f.email, "legacy.2fa"]) {
      for (const cookie of ["", trust]) {
        const denied = await login(identifier, cookie);
        expect(denied.statusCode).toBe(401);
        expect(denied.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
        expect(denied.headers["set-cookie"]).toBeUndefined();
      }
    }
    expect((await sql("select * from session where user_id = $1 order by id", [f.id])).rows).toEqual(sessions);
    expect((await sql("select * from verification order by id")).rows).toEqual(states);
  },
  MULTI_STEP_TIMEOUT_MS,
);
