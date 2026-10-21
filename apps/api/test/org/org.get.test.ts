import { Organization } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { call, expectGuardErrors, orgOf, ROLES, suspend } from "./support";

// docs/spec/features/foundation.md#ep-org.get · #contract-org
let infra: TestInfra;
let app: NestFastifyApplication;
beforeAll(async () => {
  infra = await createTestInfra();
  app = await bootTestApp([], undefined, infra);
}, 180_000);
afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

it("returns the caller's organization as the exact Organization DTO to every role", async () => {
  for (const role of ROLES) {
    const seeded = await seedOrg(app, infra, { role, branches: ["A"] });
    await infra.platformDb.$client.query("update organization set legal_name = 'บริษัท ทดสอบ', tax_id = '1234567890123' where id = $1", [
      seeded.orgId,
    ]);
    const res = await call(app, "GET", "/org", seeded.headers);
    expect(res.statusCode, role).toBe(200);
    const row = (await orgOf(infra, seeded.orgId))!;
    expect(Organization.parse(res.json())).toEqual({
      id: seeded.orgId,
      slug: row.slug,
      displayName: "Test shop",
      legalName: "บริษัท ทดสอบ",
      taxId: "1234567890123",
      phone: null,
      logoFileId: null,
      receiptFooter: null,
      status: "active",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    expect(Object.keys(res.json()).sort()).toEqual(Object.keys(Organization.shape).sort());
  }
});

it("never returns another organization", async () => {
  const a = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  const b = await seedOrg(app, infra, { role: "owner", branches: ["A"] });
  expect((await call(app, "GET", "/org", a.headers)).json().id).toBe(a.orgId);
  expect((await call(app, "GET", "/org", b.headers)).json().id).toBe(b.orgId);
});

it("still reads a suspended organization (F04)", async () => {
  const seeded = await seedOrg(app, infra, { role: "groomer", branches: ["A"] });
  await suspend(infra, seeded.orgId);
  const res = await call(app, "GET", "/org", seeded.headers);
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe("suspended");
});

it("applies the org-scoped guard errors", async () => {
  await expectGuardErrors(app, infra, "GET", "/org");
});
