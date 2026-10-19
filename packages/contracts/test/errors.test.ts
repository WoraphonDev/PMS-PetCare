import { describe, expect, it } from "vitest";
import { ErrorCode, ErrorResponse, errorHttpStatus } from "../src/index";

// Copied from docs/spec/features/foundation.md#errors — must match the spec table exactly.
const SPEC: ReadonlyArray<readonly [string, number]> = [
  ["VALIDATION_FAILED", 400],
  ["UNAUTHENTICATED", 401],
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["CONFLICT", 409],
  ["ORG_SUSPENDED", 423],
  ["PLAN_LIMIT_REACHED", 402],
  ["LAST_OWNER", 409],
  ["BRANCH_REQUIRED", 400],
  ["INVITATION_INVALID", 410],
  ["ALREADY_MEMBER", 409],
  ["RATE_LIMITED", 429],
  ["INTERNAL", 500],
  ["PASSWORD_CHANGE_REQUIRED", 403],
  ["MANAGED_ACCOUNT_ONLY", 409],
  ["TWO_FACTOR_REQUIRED", 403],
];

describe("ErrorCode", () => {
  it("contains exactly the codes in the spec", () => {
    expect([...ErrorCode.options].sort()).toEqual(SPEC.map(([code]) => code).sort());
  });
});

describe("errorHttpStatus", () => {
  it.each(SPEC)("%s → %i", (code, status) => {
    expect(errorHttpStatus[ErrorCode.parse(code)]).toBe(status);
  });

  it("has no extra keys", () => {
    expect(Object.keys(errorHttpStatus).sort()).toEqual(SPEC.map(([code]) => code).sort());
  });
});

describe("ErrorResponse", () => {
  it("accepts the envelope example from the spec", () => {
    expect(() => ErrorResponse.parse({ error: { code: "NOT_FOUND", message: "…", details: {} } })).not.toThrow();
  });

  it("accepts an envelope without details", () => {
    expect(() => ErrorResponse.parse({ error: { code: "FORBIDDEN", message: "no" } })).not.toThrow();
  });

  it("rejects unknown codes", () => {
    expect(() => ErrorResponse.parse({ error: { code: "OOPS", message: "x" } })).toThrow();
  });

  it("rejects a missing message", () => {
    expect(() => ErrorResponse.parse({ error: { code: "NOT_FOUND" } })).toThrow();
  });
});
