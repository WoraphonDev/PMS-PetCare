import { describe, expect, it } from "vitest";
import {
  STAFF_ACCOUNT_CREATE_STATUS,
  STAFF_PASSWORD_RESET_STATUS,
  StaffAccountCreateRequest,
  StaffMembershipParams,
  StaffPasswordResetRequest,
} from "../index";

// docs/spec/features/foundation.md#contract-staff-account-create · #contract-staff-password-reset · F11
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const A = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";
const B = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const base = { displayName: "Mai", username: "mai.k", password: "correct-horse-1", role: "groomer", branchIds: [A] };

describe("StaffAccountCreateRequest", () => {
  it("trims and lower-cases the username, trims the display name, keeps the password as sent", () => {
    expect(
      StaffAccountCreateRequest.parse({ ...base, displayName: "  Mai  ", username: "  Mai.K_9-x ", password: " pass word 1 " }),
    ).toEqual({ displayName: "Mai", username: "mai.k_9-x", password: " pass word 1 ", role: "groomer", branchIds: [A] });
    expect(StaffAccountCreateRequest.parse({ ...base, branchIds: [A.toUpperCase()] }).branchIds).toEqual([A]);
  });

  it("checks the username regex after normalising: 3–40 of a-z 0-9 . _ -", () => {
    for (const username of ["abc", "a".repeat(40), " ABC ", "a.b_c-d"])
      expect(StaffAccountCreateRequest.safeParse({ ...base, username }).success, username).toBe(true);
    for (const username of ["ab", "  ab  ", "a".repeat(41), "mai@shop", "mai k", "mai+1", "maï", "", "   ", 7]) {
      const result = StaffAccountCreateRequest.safeParse({ ...base, username });
      expect(result.success, String(username)).toBe(false);
      expect(fieldsOf(result), String(username)).toEqual(["username"]);
    }
  });

  it("accepts passwords of 10 and 128 characters and rejects 9 and 129 (not trimmed)", () => {
    for (const password of ["a".repeat(10), "a".repeat(128), `${" ".repeat(5)}abcde`])
      expect(StaffAccountCreateRequest.safeParse({ ...base, password }).success, password).toBe(true);
    for (const password of ["a".repeat(9), "a".repeat(129), " ".repeat(4) + "abcde", 1234567890]) {
      expect(fieldsOf(StaffAccountCreateRequest.safeParse({ ...base, password })), String(password)).toEqual(["password"]);
    }
  });

  it("limits displayName to 1–100 characters after trim", () => {
    expect(StaffAccountCreateRequest.safeParse({ ...base, displayName: "ก".repeat(100) }).success).toBe(true);
    for (const displayName of ["", "   ", "a".repeat(101), null])
      expect(fieldsOf(StaffAccountCreateRequest.safeParse({ ...base, displayName })), String(displayName)).toEqual(["displayName"]);
  });

  it("applies the invite role/branch rules: owner/manager take no branches; a branch role may be empty (BRANCH_REQUIRED is the use case's)", () => {
    for (const role of ["owner", "manager"] as const)
      expect(StaffAccountCreateRequest.safeParse({ ...base, role, branchIds: [] }).success).toBe(true);
    expect(StaffAccountCreateRequest.safeParse({ ...base, branchIds: [] }).success).toBe(true);
    for (const [body, field] of [
      [{ role: "admin" }, "role"],
      [{ role: "owner", branchIds: [A] }, "branchIds"],
      [{ branchIds: [A, A.toUpperCase()] }, "branchIds"],
      [{ branchIds: ["x"] }, "branchIds.0"],
      [{ branchIds: [A, B, "x"] }, "branchIds.2"],
    ] as const) {
      expect(fieldsOf(StaffAccountCreateRequest.safeParse({ ...base, ...body })), JSON.stringify(body)).toContain(field);
    }
  });

  it("requires every key and reports unknown keys by name", () => {
    expect(fieldsOf(StaffAccountCreateRequest.safeParse({}))).toEqual(
      expect.arrayContaining(["displayName", "username", "password", "role", "branchIds"]),
    );
    for (const key of ["email", "mustChangePassword", "orgId", "passwordHash"])
      expect(fieldsOf(StaffAccountCreateRequest.safeParse({ ...base, [key]: "x" }))).toContain(key);
    for (const body of [null, [], "x", 1]) expect(StaffAccountCreateRequest.safeParse(body).success).toBe(false);
  });

  it("answers 201", () => {
    expect(STAFF_ACCOUNT_CREATE_STATUS).toBe(201);
  });
});

describe("StaffPasswordResetRequest and StaffMembershipParams", () => {
  it("accepts newPassword of 10–128 characters, not trimmed", () => {
    for (const newPassword of ["a".repeat(10), "a".repeat(128), `  ${"a".repeat(8)}`])
      expect(StaffPasswordResetRequest.parse({ newPassword })).toEqual({ newPassword });
    for (const newPassword of ["a".repeat(9), "a".repeat(129), undefined, 1])
      expect(fieldsOf(StaffPasswordResetRequest.safeParse({ newPassword })), String(newPassword)).toEqual(["newPassword"]);
  });

  it("rejects unknown keys by name", () => {
    for (const key of ["password", "mustChangePassword"])
      expect(fieldsOf(StaffPasswordResetRequest.safeParse({ newPassword: "a".repeat(10), [key]: "x" }))).toContain(key);
    for (const body of [null, [], "x"]) expect(StaffPasswordResetRequest.safeParse(body).success).toBe(false);
  });

  it("takes one UUID membership id", () => {
    expect(StaffMembershipParams.safeParse({ membershipId: A }).success).toBe(true);
    expect(fieldsOf(StaffMembershipParams.safeParse({ membershipId: "x" }))).toEqual(["membershipId"]);
    expect(StaffMembershipParams.safeParse({ membershipId: A, other: 1 }).success).toBe(false);
  });

  it("answers 204", () => {
    expect(STAFF_PASSWORD_RESET_STATUS).toBe(204);
  });
});
