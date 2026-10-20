import { randomUUID } from "node:crypto";
import { membership, organization, withTenant } from "@app/db";
import { Controller, Get, Head, Module, Param, Post, Req } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { assertBranchInScope, type OrgRequestContext } from "../../src/common/context";
import { OrgScoped, RequirePermission } from "../../src/common/tenant.guard";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";

@Controller("probe")
@OrgScoped()
class Probe {
  @Get()
  async read(@Req() req: { ctx: OrgRequestContext }) {
    const { ctx } = req;
    return {
      userId: ctx.user.id,
      orgId: ctx.org.id,
      role: ctx.membership.role,
      branchScope: ctx.branchScope,
      requestId: ctx.requestId,
      now: ctx.now.toISOString(),
      buildSha: ctx.buildSha,
      branches: await ctx.db.run((tx) => tx.query.branch.findMany()),
    };
  }
  @Head("head")
  head() {
    return;
  }
  @Post()
  write() {
    return { ok: true };
  }
  @Get("permission")
  @RequirePermission("org.settings.update")
  permission() {
    return { ok: true };
  }
  @Get("branch/:id")
  async branch(@Req() req: { ctx: OrgRequestContext }, @Param("id") id: string) {
    assertBranchInScope(req.ctx, id);
    const found = await req.ctx.db.run((tx) => tx.query.branch.findFirst({ where: (b, { eq }) => eq(b.id, id) }));
    if (!found) {
      const { AppError } = await import("../../src/common/app-error");
      throw new AppError("NOT_FOUND");
    }
    return { id: found.id };
  }
}
@Controller("plain-probe")
class PlainProbe {
  @Get() get() {
    return { ok: true };
  }
}
@Module({ controllers: [Probe, PlainProbe] })
class ProbeModule {}
let infra: TestInfra;
let app: NestFastifyApplication;
let owner: Awaited<ReturnType<typeof seedOrg>>;
let groomer: Awaited<ReturnType<typeof seedOrg>>;
let other: Awaited<ReturnType<typeof seedOrg>>;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([ProbeModule], undefined, infra);
  owner = await seedOrg(app, infra, { role: "owner", branches: ["A", "B"] });
  groomer = await seedOrg(app, infra, { role: "groomer", branches: ["A", "B"], assignedBranchIndexes: [0] });
  other = await seedOrg(app, infra, { role: "manager", branches: ["Other"] });
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});
const request = (headers: Record<string, string>, url = "/api/v1/probe", method: "GET" | "POST" | "HEAD" | "OPTIONS" = "GET") =>
  app.inject({ method, url, headers });
async function error(headers: Record<string, string>, status: number, code: string, url?: string, method?: "GET" | "POST" | "OPTIONS") {
  const res = await request(headers, url, method);
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res;
}
it("requires a live session before reading the organization header", async () => {
  await error({}, 401, "UNAUTHENTICATED");
  await error({ ...owner.headers, cookie: "invalid" }, 401, "UNAUTHENTICATED");
});
it("validates missing/malformed organization headers", async () => {
  for (const id of [undefined, "", "not-a-uuid", `${owner.orgId},${other.orgId}`]) {
    const res = await error({ cookie: owner.cookie, ...(id === undefined ? {} : { "x-org-id": id }) }, 400, "VALIDATION_FAILED");
    expect(res.json().error.details.fields).toHaveProperty("X-Org-Id");
  }
});
it("rejects non-members and unknown orgs with FORBIDDEN", async () => {
  await error({ ...owner.headers, "x-org-id": other.orgId }, 403, "FORBIDDEN");
  await error({ ...owner.headers, "x-org-id": randomUUID() }, 403, "FORBIDDEN");
});
it("builds the request context and isolates tenant reads", async () => {
  const res = await request(owner.headers);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ userId: owner.userId, orgId: owner.orgId, role: "owner", branchScope: null, buildSha: "test-sha" });
  expect(res.json().requestId).toBe(res.headers["x-request-id"]);
  expect(Number.isNaN(Date.parse(res.json().now))).toBe(false);
  expect(
    res
      .json()
      .branches.map((b: { id: string }) => b.id)
      .sort(),
  ).toEqual(owner.branchIds.toSorted());
  const switched = await request(other.headers);
  expect(switched.json().branches.map((b: { id: string }) => b.id)).toEqual(other.branchIds);
  await error(owner.headers, 404, "NOT_FOUND", `/api/v1/probe/branch/${other.branchIds[0]}`);
});
it("enforces permissions and branch assignments", async () => {
  expect((await request(owner.headers, "/api/v1/probe/permission")).statusCode).toBe(200);
  await error(groomer.headers, 403, "FORBIDDEN", "/api/v1/probe/permission");
  expect((await request(groomer.headers)).json().branchScope).toEqual([groomer.branchIds[0]]);
  expect((await request(groomer.headers, `/api/v1/probe/branch/${groomer.branchIds[0]}`)).statusCode).toBe(200);
  await error(groomer.headers, 404, "NOT_FOUND", `/api/v1/probe/branch/${groomer.branchIds[1]}`);
  expect((await request(owner.headers, `/api/v1/probe/branch/${owner.branchIds[1]}`)).statusCode).toBe(200);
  expect((await request(other.headers)).json().branchScope).toBeNull();
});
it("suspended organizations allow GET/HEAD and deny every other guarded method", async () => {
  await withTenant(infra.runtimeDb, other.orgId, (tx) => tx.update(organization).set({ status: "suspended" }));
  expect((await request(other.headers)).statusCode).toBe(200);
  expect((await request(other.headers, "/api/v1/probe/head", "HEAD")).statusCode).toBe(200);
  await error(other.headers, 423, "ORG_SUSPENDED", undefined, "POST");
  expect((await request(owner.headers, undefined, "POST")).statusCode).toBe(201);
});
it("checks current membership on every request, including removed memberships", async () => {
  await withTenant(infra.runtimeDb, other.orgId, (tx) => tx.update(membership).set({ status: "removed" }));
  await error(other.headers, 403, "FORBIDDEN");
});
it("enforces password change even on endpoints without OrgScoped, while preserving all three exceptions", async () => {
  const forced = await seedOrg(app, infra, { role: "owner", branches: ["A"], mustChangePassword: true });
  await error(forced.headers, 403, "PASSWORD_CHANGE_REQUIRED");
  await error(forced.headers, 403, "PASSWORD_CHANGE_REQUIRED", "/api/v1/plain-probe");
  expect((await request(forced.headers, "/api/v1/me")).statusCode).toBe(200);
  const changed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/password/change",
    headers: forced.headers,
    payload: { currentPassword: forced.password, newPassword: "new-correct-horse-2" },
  });
  expect(changed.statusCode).toBe(204);
  expect((await request(forced.headers)).statusCode).toBe(200);
  await infra.platformDb.$client.query('update "user" set must_change_password = true where id = $1', [forced.userId]);
  expect((await request(forced.headers, "/api/v1/auth/logout", "POST")).statusCode).toBe(204);
});
