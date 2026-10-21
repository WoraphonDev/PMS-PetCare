import { randomUUID } from "node:crypto";
import { branch, membership, membershipBranch, organization, withTenant } from "@app/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH, type Auth } from "../../src/modules/identity";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
let app: NestFastifyApplication;
let auth: Auth;
const logs: string[] = [];
const PASSWORD = "correct-horse-1";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const BR_A1 = randomUUID();
const BR_A2 = randomUUID();
let ann: { id: string; email: string };
let staff: { id: string };

async function signUp(email: string, username?: string, verified = false) {
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: email.split("@")[0] ?? "x", ...(username ? { username } : {}) },
  });
  // Only the explicit real-email positive fixtures model completed verification.
  if (verified) await sql('update "user" set email_verified = true where id = $1', [res.user.id]);
  return res.user;
}

beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], { write: (l) => logs.push(l) }, infra);
  auth = app.get<Auth>(AUTH);

  for (const [org, slug, branches] of [
    [ORG_A, "shop-a", [BR_A1, BR_A2]],
    [ORG_B, "shop-b", [randomUUID()]],
  ] as const) {
    await withTenant(infra.runtimeDb, org, async (tx) => {
      await tx.insert(organization).values({ id: org, slug, displayName: slug });
      for (const [i, id] of branches.entries()) await tx.insert(branch).values({ id, orgId: org, name: `b${i}` });
    });
  }

  ann = await signUp("ann@example.com", "ann.k", true);
  const other = await signUp("other@example.com", undefined, true);
  staff = await signUp(`${randomUUID()}@managed.invalid`, "groomer.joe");
  await sql(`update "user" set is_managed = true, managed_by_org_id = $1, must_change_password = true where id = $2`, [ORG_A, staff.id]);

  await withTenant(infra.runtimeDb, ORG_A, async (tx) => {
    await tx.insert(membership).values({ orgId: ORG_A, userId: ann.id, role: "owner", displayName: "Ann" });
    const [g] = await tx.insert(membership).values({ orgId: ORG_A, userId: staff.id, role: "groomer", displayName: "Joe" }).returning();
    await tx.insert(membershipBranch).values({ orgId: ORG_A, membershipId: g?.id as string, branchId: BR_A2 });
    await tx.insert(membership).values({ orgId: ORG_A, userId: other.id, role: "manager", displayName: "Other" });
  });
  await withTenant(infra.runtimeDb, ORG_B, (tx) =>
    tx.insert(membership).values({ orgId: ORG_B, userId: ann.id, role: "front_desk", displayName: "Ann", status: "removed" }),
  );
}, 180_000);

afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

/** Direct SQL on the platform connection for fixture tweaks (no drizzle-orm import needed in apps/api). */
const sql = (text: string, values: unknown[]) => infra.platformDb.$client.query(text, values);

const login = (identifier: string, password = PASSWORD, remoteAddress = "10.0.0.1") =>
  app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifier, password }, remoteAddress });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((res.headers["set-cookie"] as string | string[] | undefined) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

describe("auth.login", () => {
  it("logs in with email: 200, flags, secure session cookie", async () => {
    const res = await login("ANN@example.com");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ twoFactorRequired: false, mustChangePassword: false });
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] as string[]);
    const sessionCookie = cookies.find((c) => /session_token=/.test(c));
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
  });

  it("logs in with username (case-insensitive)", async () => {
    expect((await login("Ann.K")).statusCode).toBe(200);
  });

  it("wrong password and unknown user give the same 401", async () => {
    const wrong = await login("ann@example.com", "nope-nope-nope", "10.0.0.2");
    const unknown = await login("ghost@example.com", PASSWORD, "10.0.0.2");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("blocks after 5 failures per identifier + IP, even with the right password (F11)", async () => {
    for (let i = 0; i < 5; i++) expect((await login("other@example.com", "bad-password-x", "10.0.0.5")).statusCode).toBe(401);
    const blocked = await login("other@example.com", PASSWORD, "10.0.0.5");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect((await login("other@example.com", PASSWORD, "10.0.0.6")).statusCode).toBe(200);
  });

  it("a successful login resets the failure counter", async () => {
    for (let i = 0; i < 4; i++) await login("ann.k", "bad-password-x", "10.0.0.7");
    expect((await login("ann.k", PASSWORD, "10.0.0.7")).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await login("ann.k", "bad-password-x", "10.0.0.7");
    expect((await login("ann.k", PASSWORD, "10.0.0.7")).statusCode).toBe(200);
  });

  it("a new managed account must change its password", async () => {
    const res = await login("groomer.joe");
    expect(res.statusCode).toBe(200);
    expect(res.json().mustChangePassword).toBe(true);
  });

  it("rejects an invalid body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { password: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("never writes the password to the log", () => {
    expect(logs.join("\n")).not.toContain(PASSWORD);
  });
});

describe("me.get + auth.logout", () => {
  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/me" })).statusCode).toBe(401);
  });

  it("returns the user's active memberships only, with branch scope by role", async () => {
    const cookie = cookieOf(await login("ann@example.com", PASSWORD, "10.0.1.1"));
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ id: ann.id, email: "ann@example.com", username: "ann.k", mustChangePassword: false });
    expect(body.memberships).toHaveLength(1); // removed membership in shop-b is not listed
    expect(body.memberships[0]).toMatchObject({ org: { id: ORG_A, slug: "shop-a" }, role: "owner" });
    expect(body.memberships[0].branches.map((b: { id: string }) => b.id).sort()).toEqual([BR_A1, BR_A2].sort());
    expect(JSON.stringify(body)).not.toMatch(/"password"|\$argon|scrypt|"hash"/i);
  });

  it("a branch-scoped role sees only its branches; a managed account shows no email", async () => {
    const cookie = cookieOf(await login("groomer.joe", PASSWORD, "10.0.1.2"));
    const body = (await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } })).json();
    expect(body.user.email).toBeNull();
    expect(body.memberships[0].branches.map((b: { id: string }) => b.id)).toEqual([BR_A2]);
  });

  it("logout revokes the session", async () => {
    const cookie = cookieOf(await login("ann@example.com", PASSWORD, "10.0.1.3"));
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("a managed account whose membership was removed can no longer log in (F09)", async () => {
    await sql(`update membership set status = 'removed' where user_id = $1`, [staff.id]);
    expect((await login("groomer.joe", PASSWORD, "10.0.1.4")).statusCode).toBe(401);
  });
});
