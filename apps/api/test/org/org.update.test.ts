import { Organization } from "@app/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootTestApp } from "../support/app";
import { createTestInfra, type TestInfra } from "../support/infra";
import { seedOrg } from "../support/seed";
import { auditOf, call, expectError, expectGuardErrors, orgOf, outboxOf, ROLES, suspend } from "./support";

// docs/spec/features/foundation.md#ep-org.update · #contract-org · §6 · #org-branch-technical-gates (1)
const failAudit = vi.hoisted(() => ({ on: false }));
vi.mock("@app/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@app/db")>();
  return {
    ...original,
    writeAudit: async (...args: Parameters<typeof original.writeAudit>) => {
      if (failAudit.on) throw new Error("forced audit failure");
      return original.writeAudit(...args);
    },
  };
});

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

const owner = () => seedOrg(app, infra, { role: "owner", branches: ["A"] });
const patch = (headers: Record<string, string>, body: unknown) => call(app, "PATCH", "/org", headers, body);

describe("owner update", () => {
  it("updates editable fields, returns 200 Organization and writes one org.updated audit with changed fields only", async () => {
    const o = await owner();
    const before = (await orgOf(infra, o.orgId))!;
    const res = await patch(o.headers, { displayName: "  ร้านใหม่ ", legalName: "บริษัท ใหม่", taxId: "1234567890123", phone: "021234567" });
    expect(res.statusCode).toBe(200);
    const after = (await orgOf(infra, o.orgId))!;
    expect(Organization.parse(res.json())).toEqual({
      id: o.orgId,
      slug: before.slug,
      displayName: "ร้านใหม่",
      legalName: "บริษัท ใหม่",
      taxId: "1234567890123",
      phone: "021234567",
      logoFileId: null,
      receiptFooter: null,
      status: "active",
      createdAt: before.createdAt.toISOString(),
      updatedAt: after.updatedAt.toISOString(),
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    const audit = await auditOf(infra, o.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "org.updated",
      actorUserId: o.userId,
      entityType: "organization",
      entityId: o.orgId,
      before: { displayName: "Test shop", legalName: null, taxId: null, phone: null },
      after: { displayName: "ร้านใหม่", legalName: "บริษัท ใหม่", taxId: "1234567890123", phone: "021234567" },
    });
    expect(audit[0]!.occurredAt.getTime()).toBe(after.updatedAt.getTime());
    expect(await outboxOf(infra, o.orgId)).toEqual([]);
  });

  it("clears nullable fields with null and audits only fields whose value changed", async () => {
    const o = await owner();
    await patch(o.headers, { receiptFooter: "ขอบคุณ", phone: "02" });
    const res = await patch(o.headers, { receiptFooter: null, phone: "02", displayName: "Test shop" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ receiptFooter: null, phone: "02" });
    const audit = await auditOf(infra, o.orgId);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ before: { receiptFooter: "ขอบคุณ" }, after: { receiptFooter: null } });
    expect(Object.keys(audit[1]!.after!)).toEqual(["receiptFooter"]);
  });

  it("treats a no-op PATCH as 200 with the current DTO, without UPDATE or audit", async () => {
    const o = await owner();
    const before = (await orgOf(infra, o.orgId))!;
    const res = await patch(o.headers, { displayName: "Test shop", legalName: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().updatedAt).toBe(before.updatedAt.toISOString());
    expect((await orgOf(infra, o.orgId))!.updatedAt).toEqual(before.updatedAt);
    expect(await auditOf(infra, o.orgId)).toEqual([]);
  });
});

describe("rejections leave the organization unchanged", () => {
  it("denies every role except owner", async () => {
    for (const role of ROLES.filter((r) => r !== "owner")) {
      const s = await seedOrg(app, infra, { role, branches: ["A"] });
      await expectError(await patch(s.headers, { displayName: "x" }), 403, "FORBIDDEN");
      expect((await orgOf(infra, s.orgId))!.displayName).toBe("Test shop");
      expect(await auditOf(infra, s.orgId)).toEqual([]);
    }
  });

  it("rejects slug, status, logoFileId and system fields with details.fields.<key>", async () => {
    const o = await owner();
    const before = (await orgOf(infra, o.orgId))!;
    const forbidden: Record<string, unknown> = {
      slug: "new-slug",
      status: "suspended",
      logoFileId: "00000000-0000-4000-8000-000000000000",
      id: o.orgId,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      orgId: o.orgId,
    };
    for (const [key, value] of Object.entries(forbidden)) {
      const error = await expectError(await patch(o.headers, { displayName: "changed", [key]: value }), 400, "VALIDATION_FAILED");
      expect(error.details, key).toMatchObject({ fields: { [key]: expect.any(Array) } });
    }
    expect(await orgOf(infra, o.orgId)).toEqual(before);
    expect(await auditOf(infra, o.orgId)).toEqual([]);
  });

  it("validates the wire contract", async () => {
    const o = await owner();
    const cases: Array<[unknown, string]> = [
      [{}, "_"],
      [{ displayName: null }, "displayName"],
      [{ displayName: "  " }, "displayName"],
      [{ displayName: "a".repeat(101) }, "displayName"],
      [{ legalName: "a".repeat(101) }, "legalName"],
      [{ taxId: "123" }, "taxId"],
      [{ phone: "" }, "phone"],
      [{ receiptFooter: "a".repeat(501) }, "receiptFooter"],
    ];
    for (const [body, field] of cases) {
      const error = await expectError(await patch(o.headers, body), 400, "VALIDATION_FAILED");
      expect(error.details, JSON.stringify(body)).toMatchObject({ fields: { [field]: expect.any(Array) } });
    }
    expect((await patch(o.headers, { displayName: "😀".repeat(100), receiptFooter: "ก".repeat(500) })).statusCode).toBe(200);
  });

  it("returns ORG_SUSPENDED for a suspended organization with no mutation or audit", async () => {
    const o = await owner();
    await suspend(infra, o.orgId);
    await expectError(await patch(o.headers, { displayName: "x" }), 423, "ORG_SUSPENDED");
    expect((await orgOf(infra, o.orgId))!.displayName).toBe("Test shop");
    expect(await auditOf(infra, o.orgId)).toEqual([]);
  });

  it("rolls the update back when the audit write fails", async () => {
    const o = await owner();
    const before = (await orgOf(infra, o.orgId))!;
    failAudit.on = true;
    try {
      await expectError(await patch(o.headers, { displayName: "rolled back" }), 500, "INTERNAL");
    } finally {
      failAudit.on = false;
    }
    expect(await orgOf(infra, o.orgId)).toEqual(before);
    expect(await auditOf(infra, o.orgId)).toEqual([]);
  });

  it("applies the org-scoped guard errors", async () => {
    await expectGuardErrors(app, infra, "PATCH", "/org", { displayName: "x" });
  });
});
