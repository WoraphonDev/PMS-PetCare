import { describe, expect, it } from "vitest";
import { InvitationPreviewRequest, InvitationPreviewResponse } from "../index";

// docs/spec/features/foundation.md#contract-invitation-preview — strict `{ token }`, string 1–200; the token format is
// judged by the use case (INVITATION_INVALID), not by the schema.
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const ORG = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";

describe("InvitationPreviewRequest", () => {
  it("accepts any 1–200 character string, untouched", () => {
    for (const token of ["x", `${ORG}.${"a".repeat(43)}`, "a".repeat(200)]) {
      expect(InvitationPreviewRequest.parse({ token })).toEqual({ token });
    }
  });

  it("rejects empty, too long and non-string tokens at details.fields.token", () => {
    for (const token of ["", "a".repeat(201), 1, null, ["x"], {}]) {
      expect(fieldsOf(InvitationPreviewRequest.safeParse({ token })), JSON.stringify(token)).toEqual(["token"]);
    }
  });

  it("requires the key and reports other keys by name", () => {
    expect(fieldsOf(InvitationPreviewRequest.safeParse({}))).toEqual(["token"]);
    for (const key of ["orgId", "email"]) {
      expect(fieldsOf(InvitationPreviewRequest.safeParse({ token: "x", [key]: "y" }))).toContain(key);
    }
    for (const body of [null, [], "x", 1]) expect(InvitationPreviewRequest.safeParse(body).success).toBe(false);
  });
});

describe("InvitationPreviewResponse", () => {
  it("is exactly { orgDisplayName, role, branchNames, email, expiresAt } — no account-existence field", () => {
    const body = {
      orgDisplayName: "ร้าน",
      role: "groomer",
      branchNames: ["A", "B"],
      email: "a@b.co",
      expiresAt: "2031-05-13T07:08:09.123Z",
    };
    expect(InvitationPreviewResponse.parse(body)).toEqual(body);
    expect(InvitationPreviewResponse.parse({ ...body, role: "manager", branchNames: [] })).toMatchObject({ branchNames: [] });
    for (const extra of ["accountExists", "token", "orgId"]) {
      expect(InvitationPreviewResponse.safeParse({ ...body, [extra]: true }).success, extra).toBe(false);
    }
  });
});
