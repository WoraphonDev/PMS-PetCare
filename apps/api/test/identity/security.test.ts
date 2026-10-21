import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH, type Auth, FailureLimiter } from "../../src/modules/identity";
import { bootTestApp, testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
let app: NestFastifyApplication;
const PASSWORD = "correct-horse-1";

beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  const auth = app.get<Auth>(AUTH);
  const signed = await auth.api.signUpEmail({
    body: { email: "sec@example.com", password: PASSWORD, name: "Sec", username: "groomer-joe" },
  });
  // CSRF/session positive fixture represents a verified account.
  await infra.platformDb.$client.query('update "user" set email_verified = true where id = $1', [signed.user.id]);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

const login = (identifier: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { identifier, password: PASSWORD },
    headers,
    remoteAddress: "10.9.0.1",
  });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((res.headers["set-cookie"] as string | string[] | undefined) ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

describe("username rule matches #tbl-identity", () => {
  it("a hyphenated username can log in", async () => {
    expect((await login("groomer-joe")).statusCode).toBe(200);
  });
});

describe("Origin check on mutating requests (CSRF)", () => {
  it("an untrusted Origin cannot log out a victim, and the session survives", async () => {
    const cookie = cookieOf(await login("sec@example.com"));
    const attack = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie, origin: "https://evil.shop.example" },
    });
    expect(attack.statusCode).toBe(403);
    expect(attack.json().error.code).toBe("FORBIDDEN");
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } })).statusCode).toBe(200);
  });

  it("the app's own Origin can log out", async () => {
    const cookie = cookieOf(await login("sec@example.com"));
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie, origin: testConfig.APP_ORIGIN } });
    expect(res.statusCode).toBe(204);
  });

  it("login from an untrusted Origin is refused (login CSRF)", async () => {
    expect((await login("sec@example.com", { origin: "https://evil.shop.example" })).statusCode).toBe(403);
  });

  it("reads are not affected", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health", headers: { origin: "https://evil.shop.example" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("failure counter always expires (F11)", () => {
  it("the first failure creates the key with its TTL", async () => {
    const limiter = new FailureLimiter(infra.valkey, `t-${randomUUID()}`, 5, 900);
    expect(await limiter.ttl("x", "1.1.1.1")).toBe(-2);
    await limiter.recordFailure("x", "1.1.1.1");
    const ttl = await limiter.ttl("x", "1.1.1.1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it("every later increment keeps the TTL", async () => {
    const limiter = new FailureLimiter(infra.valkey, `t-${randomUUID()}`, 5, 900);
    for (let i = 0; i < 3; i++) await limiter.recordFailure("y", "2.2.2.2");
    expect(await limiter.ttl("y", "2.2.2.2")).toBeGreaterThan(0);
  });
});
