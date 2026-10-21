import { randomUUID } from "node:crypto";
import { AuthSignupRequest } from "@app/contracts";
import { seedPlans, transactionQuery, user, withPlatform } from "@app/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../../src/modules/identity/auth";
import { isCreatedIdentity } from "../../src/modules/identity/identity.repository";
import { EMAIL_SENDER, FakeEmailSender } from "../../src/modules/notification/email";
import { bootTestApp, testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
let app: NestFastifyApplication;
let mail: FakeEmailSender;
const logs: string[] = [];

let counter = 0;
const nextIp = () => {
  counter += 1;
  return `10.41.${Math.floor(counter / 250)}.${counter % 250}`;
};
const nextSlug = () => `shop-${randomUUID().slice(0, 8)}`;
const nextEmail = () => `${randomUUID()}@example.com`;

interface SignupBody {
  email?: string;
  password?: string;
  displayName?: string;
  orgName?: string;
  orgSlug?: string;
  branchName?: string;
  [extra: string]: unknown;
}
const valid = (overrides: SignupBody = {}): SignupBody => ({
  email: nextEmail(),
  password: "correct horse 1",
  displayName: "เจ้าของร้าน",
  orgName: "ร้านน้องหมา",
  orgSlug: nextSlug(),
  branchName: "สาขาหลัก",
  ...overrides,
});
const signup = (payload: SignupBody, remoteAddress = nextIp(), headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/api/v1/auth/signup", payload, remoteAddress, headers });
const login = (identifier: string, password: string) =>
  app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier, password }, remoteAddress: nextIp() });

const db = () => infra.runtimeDb;
const users = (email: string) => db().query.user.findMany({ where: (u, { eq }) => eq(u.email, email) });
const orgs = (slug: string) =>
  withPlatform(infra.platformDb, (tx) => tx.query.organization.findMany({ where: (o, { eq }) => eq(o.slug, slug) }));
const sessionsOf = (userId: string) => db().query.session.findMany({ where: (s, { eq }) => eq(s.userId, userId) });
const verificationsOf = (userId: string) =>
  db().query.verification.findMany({ where: (v, { eq }) => eq(v.identifier, `pms:email-verify:v1:${userId}`) });
const accountsOf = (userId: string) => db().query.account.findMany({ where: (a, { eq }) => eq(a.userId, userId) });
const tokenFor = (email: string) => {
  const message = mail.sent.filter((m) => m.to === email).at(-1);
  expect(message, "no verification email was captured").toBeDefined();
  const link = new URL(message!.text.match(/http[^\s]+/)![0]);
  expect(link.pathname).toBe("/verify-email");
  expect(link.search).toBe("");
  return new URLSearchParams(link.hash.slice(1)).get("token") as string;
};
const verifyEmail = (token: string) =>
  app.inject({ method: "POST", url: "/api/v1/auth/email/verify", payload: { token }, remoteAddress: nextIp() });

const INJECTED_TABLES = ["user", "account", "verification", "organization", "branch", "branch_hours", "membership", "subscription"];
/** Literal DDL on the owner connection (no parameters) — @app/db's tagged query takes a template. */
const literal = (text: string) => Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray;
const owner = (text: string) => infra.db.migratorDb.transaction((tx) => transactionQuery(tx)(literal(text)));

/** Raises inside the signup transaction at a chosen step, as the schema owner. */
async function withInjectedFailure<T>(ddl: string, fn: () => Promise<T>): Promise<T> {
  await owner(`create or replace function t0011_fail() returns trigger language plpgsql as $$
    begin raise exception 'injected t0011 failure'; end $$`);
  await owner(ddl);
  try {
    return await fn();
  } finally {
    for (const table of INJECTED_TABLES) await owner(`drop trigger if exists t0011_injected on "${table}"`).catch(() => undefined);
  }
}
const failingRowTrigger = (table: string, when?: string) =>
  `create trigger t0011_injected before insert on "${table}" for each row ${when ? `when (${when}) ` : ""}execute function t0011_fail()`;

beforeAll(async () => {
  infra = await createTestInfra();
  await withPlatform(infra.platformDb, seedPlans);
  app = await bootTestApp([], { write: (line) => logs.push(line) }, infra);
  mail = app.get<FakeEmailSender>(EMAIL_SENDER);
}, 300_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

describe("contract (#rule-signup-input)", () => {
  it("accepts only the six contract fields, trims names and canonicalizes the email", () => {
    expect(
      AuthSignupRequest.parse({
        email: "  Owner@Example.COM ",
        password: " correct horse ",
        displayName: "  เจ้าของ  ",
        orgName: "  ร้าน  ",
        orgSlug: "my-shop",
        branchName: "  สาขา  ",
        callbackURL: "https://evil.invalid",
        username: "owner",
      }),
    ).toEqual({
      email: "owner@example.com",
      password: " correct horse ",
      displayName: "เจ้าของ",
      orgName: "ร้าน",
      orgSlug: "my-shop",
      branchName: "สาขา",
    });
  });

  it("enforces the password length on the untrimmed value", () => {
    expect(AuthSignupRequest.safeParse(valid({ password: " 12345678 " })).success).toBe(true);
    expect(AuthSignupRequest.safeParse(valid({ password: "123456789" })).success).toBe(false);
    expect(AuthSignupRequest.safeParse(valid({ password: "1234567890" })).success).toBe(true);
    expect(AuthSignupRequest.safeParse(valid({ password: "x".repeat(128) })).success).toBe(true);
    expect(AuthSignupRequest.safeParse(valid({ password: "x".repeat(129) })).success).toBe(false);
  });

  it("measures name length in characters exactly like PostgreSQL char_length", async () => {
    const astral = "🐶".repeat(100);
    expect(astral.length).toBe(200);
    const { rows } = await infra.runtimeDb.transaction(
      (tx) => transactionQuery(tx)<{ len: number }>`select char_length(${astral}::text) as len`,
    );
    expect(rows[0]?.len).toBe(100);
    expect(AuthSignupRequest.safeParse(valid({ orgName: astral })).success).toBe(true);
    expect(AuthSignupRequest.safeParse(valid({ orgName: `🐶${astral}` })).success).toBe(false);
    for (const field of ["displayName", "orgName", "branchName"] as const) {
      expect(AuthSignupRequest.safeParse(valid({ [field]: "   " })).success).toBe(false);
      expect(AuthSignupRequest.safeParse(valid({ [field]: " ก " })).success).toBe(true);
      expect(AuthSignupRequest.safeParse(valid({ [field]: "ก".repeat(100) })).success).toBe(true);
      expect(AuthSignupRequest.safeParse(valid({ [field]: "ก".repeat(101) })).success).toBe(false);
    }
  });

  it("matches the slug regex exactly and never auto-corrects it", () => {
    for (const orgSlug of ["abc", "a-b-c", "a".repeat(40), "0-9"]) {
      expect(AuthSignupRequest.safeParse(valid({ orgSlug })).success, orgSlug).toBe(true);
    }
    for (const orgSlug of ["ab", "a".repeat(41), "Abc", " abc", "abc ", "a_bc", "ร้าน", "a b", ""]) {
      expect(AuthSignupRequest.safeParse(valid({ orgSlug })).success, orgSlug).toBe(false);
    }
    expect(AuthSignupRequest.parse(valid({ orgSlug: "keep-me" })).orgSlug).toBe("keep-me");
  });
});

describe("POST /auth/signup (#ep-auth.signup, #rule-signup-atomic)", () => {
  it("creates exactly one tenant with no session, then allows login only after verification", async () => {
    const body = valid({ email: "  Owner.One@Example.COM  ", password: " correct horse 1 ", orgName: "  ร้านน้องหมา  " });
    const email = "owner.one@example.com";
    const res = await signup(body, nextIp(), { cookie: "better-auth.session_token=forged-value" });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ verificationRequired: true });
    expect(res.headers["set-cookie"]).toBeUndefined();

    const [created] = await users(email);
    expect(created).toBeDefined();
    expect(created).toMatchObject({ email, name: "เจ้าของร้าน", emailVerified: false, isManaged: false, managedByOrgId: null });
    expect(await users("Owner.One@Example.COM")).toHaveLength(0);

    const accounts = await accountsOf(created!.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ providerId: "credential" });
    expect(accounts[0]?.password).toBeTruthy();
    expect(await verificationsOf(created!.id)).toHaveLength(1);
    expect(await sessionsOf(created!.id)).toHaveLength(0);
    expect(await db().query.session.findMany()).toHaveLength(0);

    const [org] = await orgs(body.orgSlug as string);
    expect(org).toMatchObject({ slug: body.orgSlug, displayName: "ร้านน้องหมา", status: "active" });
    const tenant = await withPlatform(infra.platformDb, async (tx) => ({
      branches: await tx.query.branch.findMany({ where: (b, { eq }) => eq(b.orgId, org!.id) }),
      memberships: await tx.query.membership.findMany({ where: (m, { eq }) => eq(m.orgId, org!.id) }),
      membershipBranches: await tx.query.membershipBranch.findMany(),
      hours: await tx.query.branchHours.findMany({ where: (h, { eq }) => eq(h.orgId, org!.id) }),
      subscriptions: await tx.query.subscription.findMany({ where: (s, { eq }) => eq(s.orgId, org!.id) }),
      plans: await tx.query.plan.findMany(),
    }));
    expect(tenant.branches).toHaveLength(1);
    expect(tenant.branches[0]).toMatchObject({ name: "สาขาหลัก", timezone: "Asia/Bangkok", isActive: true });
    expect(tenant.hours.map((h) => h.weekday).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(tenant.hours.map((h) => `${h.opensAt}-${h.closesAt}`))).toEqual(new Set(["09:00:00-18:00:00"]));
    expect(tenant.memberships).toHaveLength(1);
    expect(tenant.memberships[0]).toMatchObject({ userId: created!.id, role: "owner", status: "active", displayName: "เจ้าของร้าน" });
    expect(tenant.membershipBranches).toHaveLength(0);
    expect(tenant.subscriptions).toHaveLength(1);
    const free = tenant.plans.find((p) => p.code === "mvp_free");
    expect(tenant.subscriptions[0]).toMatchObject({ planId: free!.id, currentPeriodEnd: null });

    // Verification state and login gate (#rule-email-login-policy, T-0036).
    const blocked = await login(email, " correct horse 1 ");
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(blocked.headers["set-cookie"]).toBeUndefined();

    const verified = await verifyEmail(tokenFor(email));
    expect(verified.statusCode).toBe(204);
    const ok = await login(email, " correct horse 1 ");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ twoFactorRequired: false, mustChangePassword: false });
    expect(ok.headers["set-cookie"]).toBeTruthy();
  });

  it("rejects malformed bodies with VALIDATION_FAILED and no quota consumption", async () => {
    const ip = nextIp();
    for (const payload of [
      {},
      valid({ email: "not-an-email" }),
      valid({ password: "short" }),
      valid({ orgSlug: "NOPE" }),
      valid({ orgName: "  " }),
      valid({ branchName: "ก".repeat(101) }),
    ]) {
      const res = await signup(payload, ip);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { fields: expect.any(Object) } } });
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
    expect(await infra.valkey.get(`signup-attempt:${encodeURIComponent(ip)}`)).toBeNull();
    expect(await db().query.user.findMany({ where: (u, { eq }) => eq(u.email, "not-an-email") })).toHaveLength(0);
  });

  it("maps a duplicate email to CONFLICT without a second tenant, counting the attempt", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const first = await signup(valid({ email }), ip);
    expect(first.statusCode).toBe(201);

    const slug = nextSlug();
    const again = await signup(valid({ email, orgSlug: slug }), ip);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await users(email)).toHaveLength(1);
    expect(await orgs(slug)).toHaveLength(0);
    expect(await infra.valkey.get(`signup-attempt:${encodeURIComponent(ip)}`)).toBe("2");
  });

  it("maps a historical mixed-case email to CONFLICT (canonical lowercase for every writer)", async () => {
    const legacy = `Legacy.${randomUUID().slice(0, 8)}@Example.COM`;
    await db().insert(user).values({ name: "Legacy", email: legacy });
    const slug = nextSlug();
    const res = await signup(valid({ email: legacy.toLowerCase(), orgSlug: slug }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await users(legacy.toLowerCase())).toHaveLength(0);
    expect(await orgs(slug)).toHaveLength(0);
  });

  it("maps a duplicate slug to CONFLICT without creating the identity", async () => {
    const slug = nextSlug();
    expect((await signup(valid({ orgSlug: slug }))).statusCode).toBe(201);
    const email = nextEmail();
    const res = await signup(valid({ email, orgSlug: slug }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await users(email)).toHaveLength(0);
    expect(await orgs(slug)).toHaveLength(1);
  });

  it("lets exactly one concurrent signup win for the same email and for the same slug", async () => {
    const email = nextEmail();
    const slugs = [nextSlug(), nextSlug()];
    const sameEmail = await Promise.all(slugs.map((orgSlug) => signup(valid({ email, orgSlug }))));
    expect(sameEmail.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await users(email)).toHaveLength(1);
    expect((await Promise.all(slugs.map(orgs))).flat()).toHaveLength(1);

    const slug = nextSlug();
    const emails = [nextEmail(), nextEmail()];
    const sameSlug = await Promise.all(emails.map((address) => signup(valid({ email: address, orgSlug: slug }))));
    expect(sameSlug.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await orgs(slug)).toHaveLength(1);
    expect((await Promise.all(emails.map(users))).flat()).toHaveLength(1);
  });

  it("rate-limits the sixth schema-valid attempt from one IP (#rule-signup-abuse)", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) expect((await signup(valid(), ip)).statusCode).toBe(201);
    const sixth = await signup(valid(), ip);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    const blockedEmail = valid();
    const seventh = await signup(blockedEmail, ip);
    expect(seventh.statusCode).toBe(429);
    expect(await users(blockedEmail.email as string)).toHaveLength(0);
    expect(await infra.valkey.ttl(`signup-attempt:${encodeURIComponent(ip)}`)).toBeGreaterThan(3500);
  });

  it("fails closed with INTERNAL when Valkey is unavailable, before any write", async () => {
    const body = valid();
    const broken = await bootTestApp(
      [],
      { write: () => {} },
      { ...infra, valkey: { eval: () => Promise.reject(new Error("down")) } as never },
    );
    try {
      const res = await broken.inject({ method: "POST", url: "/api/v1/auth/signup", payload: body, remoteAddress: nextIp() });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: "INTERNAL" } });
    } finally {
      await broken.close();
    }
    expect(await users(body.email as string)).toHaveLength(0);
    expect(await orgs(body.orgSlug as string)).toHaveLength(0);
  });
});

describe("atomicity (#rule-signup-atomic, #accept-signup-verification)", () => {
  const steps: [string, string][] = [
    ["identity", failingRowTrigger("user")],
    ["credential account", failingRowTrigger("account")],
    ["verification state", failingRowTrigger("verification")],
    ["organization", failingRowTrigger("organization")],
    ["branch", failingRowTrigger("branch")],
    ["owner membership", failingRowTrigger("membership")],
    ["subscription", failingRowTrigger("subscription")],
    ...([1, 2, 3, 4, 5, 6, 7] as const).map((weekday): [string, string] => [
      `branch_hours weekday ${weekday}`,
      failingRowTrigger("branch_hours", `new.weekday = ${weekday}`),
    ]),
    [
      "commit",
      `create constraint trigger t0011_injected after insert on "subscription" deferrable initially deferred
         for each row execute function t0011_fail()`,
    ],
  ];

  for (const [step, ddl] of steps) {
    it(`leaves no row and sends no message when ${step} fails`, async () => {
      const body = valid({ branchName: `สาขา-${randomUUID().slice(0, 8)}` });
      const before = mail.sent.length;
      const counts = await rowCounts();
      const res = await withInjectedFailure(ddl, () => signup(body));
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: "INTERNAL" } });
      expect(res.json()).not.toMatchObject({ error: { code: "CONFLICT" } });
      expect(JSON.stringify(res.json())).not.toContain("t0011");

      expect(await users(body.email as string)).toHaveLength(0);
      expect(await orgs(body.orgSlug as string)).toHaveLength(0);
      expect(mail.sent.slice(before)).toEqual([]);
      const branches = await withPlatform(infra.platformDb, (tx) =>
        tx.query.branch.findMany({ where: (b, { eq }) => eq(b.name, body.branchName as string) }),
      );
      expect(branches).toHaveLength(0);
      expect(await rowCounts()).toEqual(counts);
    });
  }

  it("maps an unknown unique constraint to INTERNAL, never CONFLICT", async () => {
    await owner(`create or replace function t0011_unique() returns trigger language plpgsql as $$
      begin raise exception 'injected t0011 unique' using errcode = 'unique_violation', constraint = 't0011_other_unique'; end $$`);
    const body = valid();
    const counts = await rowCounts();
    const res = await withInjectedFailure(
      `create trigger t0011_injected before insert on "organization" for each row execute function t0011_unique()`,
      () => signup(body),
    );
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(await rowCounts()).toEqual(counts);
  });

  it("maps a committed email collision from a writer outside the lock protocol to CONFLICT (DB backstop)", async () => {
    const email = nextEmail();
    const slug = nextSlug();
    const outsider = await infra.platformDb.$client.connect();
    try {
      await outsider.query("begin");
      await outsider.query(`insert into "user" (id, name, email) values ($1, 'Outsider', $2)`, [randomUUID(), email]);
      const pending = signup(valid({ email, orgSlug: slug }));
      // The signup insert blocks on user_email_unique behind the uncommitted outsider row.
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const { rows } = await infra.platformDb.$client.query(`select 1 from pg_locks where locktype = 'transactionid' and not granted`);
        waiting = rows.length > 0;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting, "signup never blocked on the outsider row").toBe(true);
      await outsider.query("commit");
      const res = await pending;
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: "CONFLICT" } });
    } finally {
      await outsider.query("rollback").catch(() => undefined);
      outsider.release();
    }
    expect(await users(email)).toHaveLength(1);
    expect(await orgs(slug)).toHaveLength(0);
  });

  it("captures each concurrent signup's message in its own collector", async () => {
    const bodies = [valid(), valid(), valid()];
    const before = mail.sent.length;
    const results = await Promise.all(bodies.map((body) => signup(body)));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    const sent = mail.sent.slice(before);
    expect(sent.map((m) => m.to).sort()).toEqual(bodies.map((b) => b.email as string).sort());
    for (const body of bodies) {
      expect(sent.filter((m) => m.to === body.email)).toHaveLength(1);
      expect((await verifyEmail(tokenFor(body.email as string))).statusCode).toBe(204);
      const [verified] = await users(body.email as string);
      expect(verified?.emailVerified).toBe(true);
    }
  });

  it("clears the organization context on the same pooled runtime connection after commit", async () => {
    await owner(`create table if not exists t0011_pid (pid int not null)`);
    await owner(`truncate t0011_pid`);
    await owner(`create or replace function t0011_record() returns trigger language plpgsql security definer as $$
      begin insert into t0011_pid values (pg_backend_pid()); return new; end $$`);
    const res = await withInjectedFailure(
      `create trigger t0011_injected after insert on "subscription" for each row execute function t0011_record()`,
      () => signup(valid()),
    );
    expect(res.statusCode).toBe(201);
    const { rows } = await infra.platformDb.$client.query<{ pid: number }>("select pid from t0011_pid");
    expect(rows).toHaveLength(1);
    let probe: { pid: number; v: string | null; n: number } | undefined;
    for (let i = 0; i < 20 && probe?.pid !== rows[0]!.pid; i++) {
      const r = await infra.runtimeDb.$client.query(
        `select pg_backend_pid() as pid, current_setting('app.org_id', true) as v, (select count(*)::int from organization) as n`,
      );
      probe = r.rows[0];
    }
    expect(probe).toEqual({ pid: rows[0]!.pid, v: "", n: 0 });
  });

  it("rejects a native synthetic success for an existing email (#rule-signup-atomic guard)", async () => {
    const email = nextEmail();
    expect((await signup(valid({ email }))).statusCode).toBe(201);
    const outcome = await infra.runtimeDb.transaction(async (tx) => {
      const auth = createAuth(testConfig, tx, mail, async () => {
        throw new Error("must not capture for a duplicate");
      });
      // autoSignIn:false makes the pinned Better Auth answer a duplicate with a fresh, unpersisted id.
      const result = await auth.api.signUpEmail({ body: { email, password: "correct horse 1", name: "Dup" } });
      expect(result.token).toBeNull();
      const [existing] = await tx.query.user.findMany({ where: (u, { eq }) => eq(u.email, email) });
      expect(result.user.id).not.toBe(existing?.id);
      return { created: await isCreatedIdentity(tx, result.user.id, email), real: await isCreatedIdentity(tx, existing!.id, email) };
    });
    expect(outcome).toEqual({ created: false, real: true });
    expect(await users(email)).toHaveLength(1);
  });

  it("keeps 201 and every row when the provider fails after commit", async () => {
    const body = valid();
    mail.failWith = new Error("smtp 554 for owner@example.com");
    let res: Awaited<ReturnType<typeof signup>>;
    try {
      res = await signup(body);
    } finally {
      mail.failWith = null;
    }
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ verificationRequired: true });
    const [created] = await users(body.email as string);
    expect(created).toBeDefined();
    expect(await verificationsOf(created!.id)).toHaveLength(1);
    expect(await orgs(body.orgSlug as string)).toHaveLength(1);
    expect(await sessionsOf(created!.id)).toHaveLength(0);

    // Recovery: the resend path re-issues and delivers for the same account.
    const resent = await app.inject({
      method: "POST",
      url: "/api/v1/auth/email/verification/resend",
      payload: { email: body.email },
      remoteAddress: nextIp(),
    });
    expect(resent.statusCode).toBe(204);
    expect((await verifyEmail(tokenFor(body.email as string))).statusCode).toBe(204);
  });

  it("never writes a token, password or recipient address to the logs", async () => {
    const body = valid({ email: `secret.${randomUUID().slice(0, 8)}@example.com`, password: "leak-me-not-123" });
    const start = logs.length;
    expect((await signup(body)).statusCode).toBe(201);
    mail.failWith = new Error("provider rejected");
    try {
      expect((await signup(valid())).statusCode).toBe(201);
    } finally {
      mail.failWith = null;
    }
    await withInjectedFailure(failingRowTrigger("membership"), () => signup(valid()));
    const written = logs.slice(start).join("\n");
    for (const secret of [body.email as string, body.password as string, tokenFor(body.email as string), "t0011_fail"]) {
      expect(written).not.toContain(secret);
    }
  });
});

/** Row count of every table signup writes (platform view, all orgs); injected failures must leave each unchanged. */
async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [...INJECTED_TABLES, "session"]) {
    const { rows } = await infra.platformDb.$client.query(`select count(*)::int as n from "${table}"`);
    counts[table] = rows[0].n;
  }
  return counts;
}
