import { describe, expect, it } from "vitest";
import { InvitationAcceptRequest, InvitationAcceptResponse } from "../index";

// docs/spec/features/foundation.md#contract-invitation-accept — strict `{ token }`, string 1–200; the token format itself
// is judged by the use case (INVITATION_INVALID), not by the schema.
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const ORG = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";

describe("InvitationAcceptRequest", () => {
  it("accepts any 1–200 character string, untouched", () => {
    for (const token of ["x", `${ORG}.${"a".repeat(43)}`, "a".repeat(200)]) {
      expect(InvitationAcceptRequest.parse({ token })).toEqual({ token });
    }
  });

  it("rejects empty, too long and non-string tokens at details.fields.token", () => {
    for (const token of ["", "a".repeat(201), 1, null, ["x"], {}]) {
      expect(fieldsOf(InvitationAcceptRequest.safeParse({ token })), JSON.stringify(token)).toEqual(["token"]);
    }
  });

  it("requires the key and reports other keys by name", () => {
    expect(fieldsOf(InvitationAcceptRequest.safeParse({}))).toEqual(["token"]);
    for (const key of ["orgId", "email", "password"]) {
      expect(fieldsOf(InvitationAcceptRequest.safeParse({ token: "x", [key]: "y" }))).toContain(key);
    }
    for (const body of [null, [], "x", 1]) expect(InvitationAcceptRequest.safeParse(body).success).toBe(false);
  });
});

describe("InvitationAcceptResponse", () => {
  it("is exactly { orgId, membershipId, role, branchIds }", () => {
    const body = { orgId: ORG, membershipId: ORG, role: "groomer", branchIds: [ORG] };
    expect(InvitationAcceptResponse.parse(body)).toEqual(body);
    expect(InvitationAcceptResponse.safeParse({ ...body, token: "x" }).success).toBe(false);
  });
});
