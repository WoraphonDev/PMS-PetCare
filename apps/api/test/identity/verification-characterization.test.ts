import { randomUUID } from "node:crypto";
import { account, type Db, session, type Tx, user, verification } from "@app/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createEmailVerificationToken } from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { testConfig } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

let infra: TestInfra;
const secret = testConfig.BETTER_AUTH_SECRET;
beforeAll(async () => {
  infra = await createTestInfra();
}, 180_000);
afterAll(async () => {
  await infra?.stop();
});

it("pinned public signer authenticates a random nonce and uses its internal clock at the exact boundary", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));
    const nonce = randomUUID();
    const token = await createEmailVerificationToken(secret, "SPIKE@example.com", undefined, 86400, { nonce });
    const second = await createEmailVerificationToken(secret, "SPIKE@example.com", undefined, 86400, { nonce: randomUUID() });
    expect(second).not.toBe(token);
    expect(await verifyJWT(token, secret)).toMatchObject({
      email: "spike@example.com",
      nonce,
      exp: Date.parse("2026-10-22T00:00:00Z") / 1000,
    });
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    parts[1] = Buffer.from(JSON.stringify({ ...payload, nonce: randomUUID() })).toString("base64url");
    expect(await verifyJWT(parts.join("."), secret)).toBeNull();
    expect(await verifyJWT(token, `${secret}-wrong`)).toBeNull();
    vi.setSystemTime(new Date("2026-10-21T23:59:59.999Z"));
    expect(await verifyJWT(token, secret)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
    expect(await verifyJWT(token, secret)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("pinned public verifier returns null rather than throwing for malformed JWT segments", async () => {
  for (const token of ["malformed", "a.b.c", "%%%.e30.signature", "bm90LWpzb24.e30.signature"]) {
    await expect(verifyJWT(token, secret)).resolves.toBeNull();
  }
});

function auth(db: Db | Tx, capture: (id: string) => Promise<void>) {
  return betterAuth({
    secret,
    baseURL: testConfig.APP_ORIGIN,
    database: drizzleAdapter(db, { provider: "pg", schema: { user, account, session, verification } }),
    emailAndPassword: { enabled: true, autoSignIn: false },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendOnSignIn: false,
      sendVerificationEmail: async ({ user }) => capture(user.id),
    },
    advanced: { database: { generateId: "uuid" } },
  });
}

it("Db composition commits while Tx callbacks see uncommitted rows on the supplied runtime connection and roll back", async () => {
  const direct = await auth(infra.runtimeDb, async () => {}).api.signUpEmail({
    body: { email: `${randomUUID()}@example.com`, name: "Spike", password: "correct-horse-1" },
  });
  expect(await infra.runtimeDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, direct.user.id) })).toBeDefined();
  let captured = "";
  await expect(
    infra.runtimeDb.transaction(async (tx) => {
      const instance = auth(tx, async (id) => {
        captured = id;
        expect(await tx.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) })).toBeDefined();
        expect(await infra.runtimeDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) })).toBeUndefined();
        await tx
          .insert(verification)
          .values({ id: randomUUID(), identifier: `pms:email-verify:v1:${id}`, value: "spike", expiresAt: new Date("2099-01-01Z") });
      });
      const result = await instance.api.signUpEmail({
        body: { email: `${randomUUID()}@example.com`, name: "Spike", password: "correct-horse-1" },
      });
      expect(result.token).toBeNull();
      expect(captured).toBe(result.user.id);
      throw new Error("rollback probe");
    }),
  ).rejects.toThrow("rollback probe");
  expect(captured).not.toBe("");
  expect(await infra.runtimeDb.query.user.findFirst({ where: (u, { eq }) => eq(u.id, captured) })).toBeUndefined();
  expect(await infra.runtimeDb.query.verification.findMany()).toEqual([]);
  expect(await infra.runtimeDb.query.session.findMany()).toEqual([]);
});
