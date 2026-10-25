import { describe, expect, it } from "vitest";
import { AuthSignupWithInvitationRequest, AuthSignupWithInvitationResponse } from "../index";

// docs/spec/features/foundation.md#contract-signup-with-invitation — strict `{ token, displayName, password }`: token 1–200,
// displayName trimmed 1–100 code points (char_length), password 10–128 untrimmed (F11); no email.
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const ORG = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";
const base = { token: `${ORG}.${"a".repeat(43)}`, displayName: "Nok", password: "correct-horse" };

describe("AuthSignupWithInvitationRequest", () => {
  it("trims displayName and keeps token and password untouched", () => {
    expect(AuthSignupWithInvitationRequest.parse({ ...base, displayName: "  Nok  ", password: " spaced pw " })).toEqual({
      ...base,
      displayName: "Nok",
      password: " spaced pw ",
    });
  });

  it("checks token 1–200", () => {
    expect(AuthSignupWithInvitationRequest.safeParse({ ...base, token: "a".repeat(200) }).success).toBe(true);
    for (const token of ["", "a".repeat(201), 1, null]) {
      expect(fieldsOf(AuthSignupWithInvitationRequest.safeParse({ ...base, token })), JSON.stringify(token)).toEqual(["token"]);
    }
  });

  it("measures displayName in code points after trim (1–100)", () => {
    expect(AuthSignupWithInvitationRequest.safeParse({ ...base, displayName: "😀".repeat(100) }).success).toBe(true);
    for (const displayName of ["", "   ", "😀".repeat(101), "a".repeat(101)]) {
      expect(fieldsOf(AuthSignupWithInvitationRequest.safeParse({ ...base, displayName })), displayName).toEqual(["displayName"]);
    }
  });

  it("checks password length 10–128 (F11)", () => {
    for (const password of ["a".repeat(10), "a".repeat(128)]) {
      expect(AuthSignupWithInvitationRequest.safeParse({ ...base, password }).success).toBe(true);
    }
    for (const password of ["a".repeat(9), "a".repeat(129)]) {
      expect(fieldsOf(AuthSignupWithInvitationRequest.safeParse({ ...base, password }))).toEqual(["password"]);
    }
  });

  it("requires every key and rejects others by name, email included", () => {
    expect(fieldsOf(AuthSignupWithInvitationRequest.safeParse({})).sort()).toEqual(["displayName", "password", "token"]);
    for (const key of ["email", "orgName", "orgSlug"]) {
      expect(fieldsOf(AuthSignupWithInvitationRequest.safeParse({ ...base, [key]: "x" }))).toContain(key);
    }
  });
});

describe("AuthSignupWithInvitationResponse", () => {
  it("is exactly { orgId, role }", () => {
    const body = { orgId: ORG, role: "front_desk" };
    expect(AuthSignupWithInvitationResponse.parse(body)).toEqual(body);
    expect(AuthSignupWithInvitationResponse.safeParse({ ...body, userId: ORG }).success).toBe(false);
  });
});
