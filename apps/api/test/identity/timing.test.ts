import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AUTH, type Auth } from "../../src/modules/identity";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";

// Account enumeration by timing: every failing path must do password hashing work.
let infra: TestInfra;
let app: NestFastifyApplication;
let auth: Auth;

beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
  auth = app.get<Auth>(AUTH);
  const { user } = await auth.api.signUpEmail({
    body: { email: "t@example.com", password: "correct-horse-1", name: "T", username: "staff.t" },
  });
  const orgId = crypto.randomUUID();
  await infra.platformDb.$client.query(`insert into organization (id, slug, display_name) values ($1, 'timing-shop', 'x')`, [orgId]);
  await infra.platformDb.$client.query(`update "user" set is_managed = true, managed_by_org_id = $1 where id = $2`, [orgId, user.id]);
  // no active membership → disabled managed account
}, 180_000);

afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

describe("failing logins all do password work", () => {
  it("a disabled managed account hashes the presented password before failing", async () => {
    const ctx = await auth.$context;
    const hash = vi.spyOn(ctx.password, "hash");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifier: "staff.t", password: "whatever-pass" },
      remoteAddress: "10.8.0.1",
    });
    expect(res.statusCode).toBe(401);
    expect(hash).toHaveBeenCalledWith("whatever-pass");
    hash.mockRestore();
  });
});
