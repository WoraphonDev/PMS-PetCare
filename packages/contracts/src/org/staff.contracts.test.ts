import { describe, expect, it } from "vitest";
import { Invitation, StaffInvitationParams, StaffInviteRequest, StaffListResponse } from "../index";

// docs/spec/features/foundation.md#contract-staff-invite · #contract-staff-invitation-revoke · #contract-staff-list
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const A = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";
const B = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe("StaffInviteRequest", () => {
  it("trims and lower-cases the email and lower-cases branch ids", () => {
    expect(StaffInviteRequest.parse({ email: "  Mai@Example.COM ", role: "groomer", branchIds: [A.toUpperCase()] })).toEqual({
      email: "mai@example.com",
      role: "groomer",
      branchIds: [A],
    });
  });

  it("accepts owner/manager with no branches and a branch role with an empty list (BRANCH_REQUIRED is the use case's)", () => {
    for (const role of ["owner", "manager"] as const)
      expect(StaffInviteRequest.safeParse({ email: "a@b.co", role, branchIds: [] }).success).toBe(true);
    expect(StaffInviteRequest.safeParse({ email: "a@b.co", role: "front_desk", branchIds: [] }).success).toBe(true);
  });

  it("rejects bad emails, including managed placeholders and addresses over 254 characters", () => {
    for (const email of ["", "   ", "not-an-email", "a@", `${A}@managed.invalid`, ` X@MANAGED.INVALID `, `${"a".repeat(245)}@example.co`]) {
      const result = StaffInviteRequest.safeParse({ email, role: "groomer", branchIds: [A] });
      expect(result.success, email).toBe(false);
      expect(fieldsOf(result), email).toEqual(["email"]);
    }
  });

  it("rejects unknown roles, malformed or duplicate branch ids and branches on owner/manager at branchIds", () => {
    expect(fieldsOf(StaffInviteRequest.safeParse({ email: "a@b.co", role: "admin", branchIds: [] }))).toEqual(["role"]);
    for (const [body, field] of [
      [{ role: "groomer", branchIds: ["not-a-uuid"] }, "branchIds.0"],
      [{ role: "groomer", branchIds: [A, A.toUpperCase()] }, "branchIds"],
      [{ role: "owner", branchIds: [A] }, "branchIds"],
      [{ role: "manager", branchIds: [A, B] }, "branchIds"],
      [{ role: "groomer", branchIds: "x" }, "branchIds"],
    ] as const) {
      const result = StaffInviteRequest.safeParse({ email: "a@b.co", ...body });
      expect(result.success, JSON.stringify(body)).toBe(false);
      expect(fieldsOf(result), JSON.stringify(body)).toContain(field);
    }
  });

  it("requires every key and reports unknown keys by name", () => {
    expect(fieldsOf(StaffInviteRequest.safeParse({}))).toEqual(expect.arrayContaining(["email", "role", "branchIds"]));
    for (const key of ["orgId", "token", "expiresAt", "displayName"]) {
      expect(fieldsOf(StaffInviteRequest.safeParse({ email: "a@b.co", role: "owner", branchIds: [], [key]: "x" }))).toContain(key);
    }
    for (const body of [null, [], "x", 1]) expect(StaffInviteRequest.safeParse(body).success).toBe(false);
  });
});

describe("StaffInvitationParams", () => {
  it("accepts one UUID and rejects anything else", () => {
    expect(StaffInvitationParams.safeParse({ invitationId: A }).success).toBe(true);
    expect(fieldsOf(StaffInvitationParams.safeParse({ invitationId: "x" }))).toEqual(["invitationId"]);
  });
});

describe("response shapes", () => {
  const invitation = {
    id: A,
    email: "a@b.co",
    role: "groomer",
    branchIds: [B],
    expiresAt: "2031-05-13T07:08:09.123Z",
    invitedByUserId: B,
    createdAt: "2031-05-06T07:08:09.123Z",
  };

  it("Invitation never carries a token or hash", () => {
    expect(Invitation.parse(invitation)).toEqual(invitation);
    expect(Invitation.safeParse({ ...invitation, token: "x" }).success).toBe(false);
    expect(Invitation.safeParse({ ...invitation, tokenHash: "x" }).success).toBe(false);
  });

  it("StaffListResponse holds members and pending invitations", () => {
    const member = {
      membershipId: A,
      userId: B,
      displayName: "Mai",
      email: null,
      username: "mai.k",
      role: "groomer",
      branchIds: [B],
      status: "active",
      isManaged: true,
      twoFactorEnabled: false,
      createdAt: "2031-05-06T07:08:09.123Z",
    };
    expect(StaffListResponse.parse({ members: [member], invitations: [invitation] })).toEqual({
      members: [member],
      invitations: [invitation],
    });
  });
});
