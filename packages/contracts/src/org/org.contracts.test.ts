import { describe, expect, it } from "vitest";
import {
  Branch,
  BranchCreateRequest,
  BranchIdParam,
  BranchListResponse,
  BranchUpdateRequest,
  Organization,
  OrgUpdateRequest,
} from "../index";

// docs/spec/features/foundation.md#contract-org, #contract-branch, #rule-branch-list and the §10 shared rules.
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join("."));

describe("OrgUpdateRequest", () => {
  it("accepts the editable fields, trims strings and allows null on nullable fields", () => {
    expect(
      OrgUpdateRequest.parse({ displayName: "  ร้าน  ", legalName: null, taxId: "1234567890123", phone: " 02 ", receiptFooter: null }),
    ).toEqual({
      displayName: "ร้าน",
      legalName: null,
      taxId: "1234567890123",
      phone: "02",
      receiptFooter: null,
    });
  });

  it("counts length in code points like PostgreSQL char_length", () => {
    expect(OrgUpdateRequest.safeParse({ displayName: "😀".repeat(100) }).success).toBe(true);
    expect(OrgUpdateRequest.safeParse({ displayName: "😀".repeat(101) }).success).toBe(false);
    expect(OrgUpdateRequest.safeParse({ legalName: "a".repeat(100) }).success).toBe(true);
    expect(OrgUpdateRequest.safeParse({ legalName: "a".repeat(101) }).success).toBe(false);
    expect(OrgUpdateRequest.safeParse({ phone: "a".repeat(101) }).success).toBe(false);
    expect(OrgUpdateRequest.safeParse({ receiptFooter: "ก".repeat(500) }).success).toBe(true);
    expect(OrgUpdateRequest.safeParse({ receiptFooter: "ก".repeat(501) }).success).toBe(false);
  });

  it("rejects null displayName, blank strings and malformed tax ids", () => {
    for (const body of [
      { displayName: null },
      { displayName: "   " },
      { legalName: "" },
      { phone: " " },
      { receiptFooter: "" },
      { taxId: "123456789012" },
      { taxId: "12345678901234" },
      { taxId: "12345678901a3" },
    ]) {
      expect(OrgUpdateRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("rejects an empty body and every non-editable key with the key as the error path", () => {
    expect(OrgUpdateRequest.safeParse({}).success).toBe(false);
    for (const key of ["slug", "status", "logoFileId", "id", "createdAt", "updatedAt", "orgId", "unknown"]) {
      const result = OrgUpdateRequest.safeParse({ displayName: "ok", [key]: "x" });
      expect(result.success, key).toBe(false);
      expect(fieldsOf(result)).toContain(key);
    }
  });
});

describe("BranchCreateRequest", () => {
  it("defaults omitted optional fields to null", () => {
    expect(BranchCreateRequest.parse({ name: " สาขา 2 " })).toEqual({
      name: "สาขา 2",
      address: null,
      phone: null,
      latitude: null,
      longitude: null,
    });
  });

  it("accepts boundary coordinates with up to 6 decimals", () => {
    for (const [latitude, longitude] of [
      [90, 180],
      [-90, -180],
      [13.756331, 100.501765],
      [0, 0],
    ]) {
      expect(BranchCreateRequest.safeParse({ name: "a", latitude, longitude }).success, `${latitude},${longitude}`).toBe(true);
    }
  });

  it("rejects out-of-range, over-precise, unpaired or mixed coordinates", () => {
    for (const coords of [
      { latitude: 90.000001, longitude: 0 },
      { latitude: 0, longitude: -180.000001 },
      { latitude: 13.7563311, longitude: 100.5 },
      { latitude: 1e-7, longitude: 0 },
      { latitude: 13.7 },
      { longitude: 100.5 },
      { latitude: 13.7, longitude: null },
      { latitude: null, longitude: 100.5 },
      { latitude: "13.7", longitude: "100.5" },
    ]) {
      expect(BranchCreateRequest.safeParse({ name: "a", ...coords }).success, JSON.stringify(coords)).toBe(false);
    }
    expect(BranchCreateRequest.safeParse({ name: "a", latitude: null, longitude: null }).success).toBe(true);
  });

  it("enforces name/address/phone lengths and rejects null name", () => {
    expect(BranchCreateRequest.safeParse({ name: "a".repeat(100) }).success).toBe(true);
    expect(BranchCreateRequest.safeParse({ name: "a".repeat(101) }).success).toBe(false);
    expect(BranchCreateRequest.safeParse({ name: null }).success).toBe(false);
    expect(BranchCreateRequest.safeParse({}).success).toBe(false);
    expect(BranchCreateRequest.safeParse({ name: "a", address: "a".repeat(500) }).success).toBe(true);
    expect(BranchCreateRequest.safeParse({ name: "a", address: "a".repeat(501) }).success).toBe(false);
    expect(BranchCreateRequest.safeParse({ name: "a", phone: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects server-owned and unknown keys with the key as the error path", () => {
    for (const key of ["promptpayId", "timezone", "isActive", "version", "id", "orgId", "createdAt", "updatedAt"]) {
      const result = BranchCreateRequest.safeParse({ name: "a", [key]: null });
      expect(result.success, key).toBe(false);
      expect(fieldsOf(result)).toContain(key);
    }
  });
});

describe("BranchUpdateRequest", () => {
  it("accepts partial updates including isActive and coordinate pairs", () => {
    expect(BranchUpdateRequest.parse({ isActive: false })).toEqual({ isActive: false });
    expect(BranchUpdateRequest.parse({ latitude: null, longitude: null })).toEqual({ latitude: null, longitude: null });
    expect(BranchUpdateRequest.parse({ name: " x ", address: null })).toEqual({ name: "x", address: null });
  });

  it("rejects empty bodies, null name, unpaired coordinates and forbidden keys", () => {
    expect(BranchUpdateRequest.safeParse({}).success).toBe(false);
    expect(BranchUpdateRequest.safeParse({ name: null }).success).toBe(false);
    expect(BranchUpdateRequest.safeParse({ isActive: null }).success).toBe(false);
    expect(BranchUpdateRequest.safeParse({ latitude: 13.7 }).success).toBe(false);
    for (const key of ["promptpayId", "timezone", "version", "id", "orgId", "createdAt", "updatedAt"]) {
      const result = BranchUpdateRequest.safeParse({ name: "a", [key]: null });
      expect(result.success, key).toBe(false);
      expect(fieldsOf(result)).toContain(key);
    }
  });

  it("validates the path id as a UUID", () => {
    expect(BranchIdParam.safeParse("00000000-0000-4000-8000-000000000000").success).toBe(true);
    expect(BranchIdParam.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("response DTOs", () => {
  const now = "2026-10-21T00:00:00.000Z";
  it("Organization has exactly the contract keys", () => {
    const org = {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "shop",
      displayName: "Shop",
      legalName: null,
      taxId: null,
      phone: null,
      logoFileId: null,
      receiptFooter: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    expect(Organization.parse(org)).toEqual(org);
    expect(Organization.safeParse({ ...org, orgId: org.id }).success).toBe(false);
  });

  it("Branch has exactly the contract keys and numeric coordinates", () => {
    const b = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "A",
      address: null,
      phone: null,
      latitude: 13.75,
      longitude: 100.5,
      timezone: "Asia/Bangkok",
      promptpayId: null,
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    expect(Branch.parse(b)).toEqual(b);
    expect(BranchListResponse.parse({ items: [b] })).toEqual({ items: [b] });
    expect(Branch.safeParse({ ...b, orgId: b.id }).success).toBe(false);
    expect(Branch.safeParse({ ...b, latitude: "13.75" }).success).toBe(false);
  });
});
