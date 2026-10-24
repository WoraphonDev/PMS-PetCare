import { describe, expect, it } from "vitest";
import { PlatformOrgSetPlanRequest, PlatformPlanListResponse } from "../index";

// docs/spec/features/foundation.md#contract-platform-set-plan (T-0020-01 A) · #contract-platform-plan-list (T-0020-02 A)
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");

describe("PlatformOrgSetPlanRequest", () => {
  it("replaces: omitted currentPeriodEnd / note become null; strings are trimmed", () => {
    expect(PlatformOrgSetPlanRequest.parse({ planCode: " pro " })).toEqual({ planCode: "pro", currentPeriodEnd: null, note: null });
    expect(
      PlatformOrgSetPlanRequest.parse({ planCode: "pro", currentPeriodEnd: "2031-06-01T00:00:00.123456+07:00", note: "  ลด 50%  " }),
    ).toEqual({ planCode: "pro", currentPeriodEnd: "2031-06-01T00:00:00.123456+07:00", note: "ลด 50%" });
    expect(PlatformOrgSetPlanRequest.parse({ planCode: "pro", currentPeriodEnd: null, note: null })).toEqual({
      planCode: "pro",
      currentPeriodEnd: null,
      note: null,
    });
  });

  it("accepts a past period end and the calendar edges Postgres accepts", () => {
    for (const at of ["2001-01-01T00:00:00Z", "2032-02-29T23:59:59Z", "0001-01-01T00:00:00Z", "2031-05-06T00:00:00-15:59"]) {
      expect(PlatformOrgSetPlanRequest.safeParse({ planCode: "pro", currentPeriodEnd: at }).success, at).toBe(true);
    }
  });

  it("rejects a missing or bad planCode, bad instants, a bad note and unknown keys at their own field", () => {
    expect(fieldsOf(PlatformOrgSetPlanRequest.safeParse({}))).toEqual(["planCode"]);
    for (const planCode of ["", "  ", "a".repeat(51), null, 1]) {
      expect(fieldsOf(PlatformOrgSetPlanRequest.safeParse({ planCode })), String(planCode)).toEqual(["planCode"]);
    }
    for (const at of [
      "2031-06-01",
      "2031-06-01T00:00:00",
      "2031-02-31T00:00:00Z",
      "2030-02-29T00:00:00Z",
      "2031-13-01T00:00:00Z",
      "2031-05-06T24:00:00Z",
      "0000-01-01T00:00:00Z",
      "2031-05-06T00:00:00+16:00",
      1_800_000_000_000,
    ]) {
      expect(fieldsOf(PlatformOrgSetPlanRequest.safeParse({ planCode: "pro", currentPeriodEnd: at })), String(at)).toEqual([
        "currentPeriodEnd",
      ]);
    }
    for (const note of ["", "   ", "a".repeat(501)]) {
      expect(fieldsOf(PlatformOrgSetPlanRequest.safeParse({ planCode: "pro", note })), note).toEqual(["note"]);
    }
    expect(fieldsOf(PlatformOrgSetPlanRequest.safeParse({ planCode: "pro", startedAt: "x", planId: "y" }))).toEqual([
      "startedAt",
      "planId",
    ]);
  });
});

describe("PlatformPlanListResponse", () => {
  it("parses the spec shape and rejects extra keys", () => {
    const item = { code: "mvp_free", name: "Free", maxBranches: 1, maxStaff: 5, priceSatangPerMonth: 0, isActive: true };
    expect(PlatformPlanListResponse.parse({ items: [item] })).toEqual({ items: [item] });
    expect(PlatformPlanListResponse.safeParse({ items: [{ ...item, id: "x" }] }).success).toBe(false);
  });
});
