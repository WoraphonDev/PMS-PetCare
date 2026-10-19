// DB-level constraints that mirror docs/spec/features/foundation.md#tbl-organization / #tbl-branch.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branch, organization, withTenant } from "../src";
import { createTestDb, type TestDb } from "./support/test-db";

let t: TestDb;
const ORG = randomUUID();

beforeAll(async () => {
  t = await createTestDb();
  await withTenant(t.runtimeDb, ORG, (tx) => tx.insert(organization).values({ id: ORG, slug: "shop-c", displayName: "Shop C" }));
}, 120_000);

afterAll(async () => {
  await t?.stop();
});

const checkViolation = (constraint: string) => ({ cause: expect.objectContaining({ code: "23514", constraint }) });

async function insertBranch(values: Partial<typeof branch.$inferInsert>) {
  return withTenant(t.runtimeDb, ORG, (tx) => tx.insert(branch).values({ orgId: ORG, name: `b-${randomUUID()}`, ...values })).catch(
    (e) => e,
  );
}

async function insertOrg(values: Partial<typeof organization.$inferInsert>) {
  const id = randomUUID();
  return withTenant(t.runtimeDb, id, (tx) =>
    tx.insert(organization).values({ id, slug: `s-${id.slice(0, 8)}`, displayName: "x", ...values }),
  ).catch((e) => e);
}

describe("branch.promptpay_id (F08 format)", () => {
  it.each(["0812345678", "1234567890123", null])("accepts %j", async (promptpayId) => {
    expect(await insertBranch({ promptpayId })).not.toBeInstanceOf(Error);
  });

  it.each(["abc", "081234567", "08123456789", "1812345678", "123456789012", "12345678901234", "081-234-5678"])(
    "rejects %j",
    async (promptpayId) => {
      expect(await insertBranch({ promptpayId })).toMatchObject(checkViolation("branch_promptpay_id_format"));
    },
  );
});

describe("branch.timezone (F06)", () => {
  it("defaults to Asia/Bangkok and rejects others", async () => {
    expect(await insertBranch({})).not.toBeInstanceOf(Error);
    expect(await insertBranch({ timezone: "UTC" })).toMatchObject(checkViolation("branch_timezone_mvp"));
  });
});

describe("organization", () => {
  it.each(["ab", "Shop", "shop_a", "a".repeat(41)])("rejects slug %j", async (slug) => {
    expect(await insertOrg({ slug })).toMatchObject(checkViolation("organization_slug_format"));
  });

  it("rejects display_name outside 1–100 chars", async () => {
    expect(await insertOrg({ displayName: "" })).toMatchObject(checkViolation("organization_display_name_length"));
    expect(await insertOrg({ displayName: "ก".repeat(101) })).toMatchObject(checkViolation("organization_display_name_length"));
    expect(await insertOrg({ displayName: "ก".repeat(100) })).not.toBeInstanceOf(Error);
  });

  it("tax_id must be 13 digits when present", async () => {
    expect(await insertOrg({ taxId: "123456789012" })).toMatchObject(checkViolation("organization_tax_id_format"));
    expect(await insertOrg({ taxId: "1234567890123" })).not.toBeInstanceOf(Error);
    expect(await insertOrg({ taxId: null })).not.toBeInstanceOf(Error);
  });

  it("receipt_footer is at most 500 chars", async () => {
    expect(await insertOrg({ receiptFooter: "x".repeat(501) })).toMatchObject(checkViolation("organization_receipt_footer_length"));
    expect(await insertOrg({ receiptFooter: "x".repeat(500) })).not.toBeInstanceOf(Error);
  });
});
