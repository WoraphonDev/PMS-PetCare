import { describe, expect, it } from "vitest";
import { STAFF_REMOVE_STATUS, STAFF_UPDATE_STATUS, StaffMembershipParams, StaffUpdateRequest } from "../index";

// docs/spec/features/foundation.md#contract-staff-update · #contract-staff-remove
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const A = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";
const B = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe("StaffUpdateRequest", () => {
  it("accepts any non-empty subset of displayName, role and branchIds; trims the name and lower-cases branch ids", () => {
    expect(StaffUpdateRequest.parse({ displayName: "  Mai  " })).toEqual({ displayName: "Mai" });
    expect(StaffUpdateRequest.parse({ role: "manager" })).toEqual({ role: "manager" });
    expect(StaffUpdateRequest.parse({ branchIds: [A.toUpperCase(), B] })).toEqual({ branchIds: [A, B] });
    expect(StaffUpdateRequest.parse({ role: "groomer", branchIds: [A], displayName: "M" })).toEqual({
      role: "groomer",
      branchIds: [A],
      displayName: "M",
    });
  });

  it("rejects an empty PATCH at `_`", () => {
    expect(fieldsOf(StaffUpdateRequest.safeParse({}))).toEqual(["_"]);
  });

  it("allows an empty branch list (BRANCH_REQUIRED is the use case's) and owner/manager with []", () => {
    expect(StaffUpdateRequest.safeParse({ branchIds: [] }).success).toBe(true);
    expect(StaffUpdateRequest.safeParse({ role: "groomer", branchIds: [] }).success).toBe(true);
    for (const role of ["owner", "manager"] as const) expect(StaffUpdateRequest.safeParse({ role, branchIds: [] }).success).toBe(true);
  });

  it("applies the invite branch rules: owner/manager with branches, duplicates and malformed ids at branchIds", () => {
    for (const [body, field] of [
      [{ role: "owner", branchIds: [A] }, "branchIds"],
      [{ role: "manager", branchIds: [A] }, "branchIds"],
      [{ branchIds: [A, A.toUpperCase()] }, "branchIds"],
      [{ branchIds: ["x"] }, "branchIds.0"],
      [{ branchIds: "x" }, "branchIds"],
      [{ role: "admin" }, "role"],
      [{ role: null }, "role"],
      [{ displayName: "   " }, "displayName"],
      [{ displayName: "a".repeat(101) }, "displayName"],
    ] as const) {
      const result = StaffUpdateRequest.safeParse(body);
      expect(result.success, JSON.stringify(body)).toBe(false);
      expect(fieldsOf(result), JSON.stringify(body)).toContain(field);
    }
  });

  it("reports unknown keys by name and rejects non-objects", () => {
    for (const key of ["status", "userId", "email", "username"])
      expect(fieldsOf(StaffUpdateRequest.safeParse({ displayName: "M", [key]: "x" }))).toContain(key);
    for (const body of [null, [], "x", 1]) expect(StaffUpdateRequest.safeParse(body).success).toBe(false);
  });

  it("uses the shared membership id params and answers 200 / 204", () => {
    expect(StaffMembershipParams.safeParse({ membershipId: A }).success).toBe(true);
    expect(STAFF_UPDATE_STATUS).toBe(200);
    expect(STAFF_REMOVE_STATUS).toBe(204);
  });
});
