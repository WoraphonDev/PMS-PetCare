import { describe, expect, it } from "vitest";
import {
  PlatformOrgDetail,
  PlatformOrgIdParam,
  PlatformOrgListQuery,
  PlatformOrgListResponse,
  PlatformOrgSetStatusRequest,
} from "../index";

// docs/spec/features/foundation.md#contract-platform-org-read (T-0019-01 B) · #contract-platform-org-status (T-0019-02 A)
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const A = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";
const AT = "2031-05-06T07:08:09.123Z";

describe("PlatformOrgListQuery", () => {
  it("accepts no filter, and each of q / status / cursor; q is trimmed", () => {
    expect(PlatformOrgListQuery.parse({})).toEqual({});
    expect(PlatformOrgListQuery.parse({ q: "  ร้าน  " })).toEqual({ q: "ร้าน" });
    expect(PlatformOrgListQuery.parse({ status: "suspended" })).toEqual({ status: "suspended" });
    expect(PlatformOrgListQuery.parse({ status: "active", cursor: "abc" })).toEqual({ status: "active", cursor: "abc" });
  });

  it("q is 1–100 code points after trim", () => {
    expect(PlatformOrgListQuery.safeParse({ q: "😀".repeat(100) }).success).toBe(true);
    for (const q of ["", "   ", "a".repeat(101)]) expect(fieldsOf(PlatformOrgListQuery.safeParse({ q })), q).toEqual(["q"]);
  });

  it("rejects bad values and unknown keys at their own field", () => {
    expect(fieldsOf(PlatformOrgListQuery.safeParse({ status: "closed" }))).toEqual(["status"]);
    expect(fieldsOf(PlatformOrgListQuery.safeParse({ cursor: "" }))).toEqual(["cursor"]);
    expect(fieldsOf(PlatformOrgListQuery.safeParse({ q: ["a", "b"] }))).toEqual(["q"]);
    expect(fieldsOf(PlatformOrgListQuery.safeParse({ limit: "10", orgId: A }))).toEqual(["limit", "orgId"]);
  });
});

describe("PlatformOrgIdParam", () => {
  it("accepts a UUID only", () => {
    expect(PlatformOrgIdParam.safeParse(A).success).toBe(true);
    expect(PlatformOrgIdParam.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("PlatformOrgSetStatusRequest", () => {
  it("is strict { status, reason } with reason trimmed 1–500, required both ways", () => {
    expect(PlatformOrgSetStatusRequest.parse({ status: "suspended", reason: "  ค้างชำระ  " })).toEqual({
      status: "suspended",
      reason: "ค้างชำระ",
    });
    expect(PlatformOrgSetStatusRequest.safeParse({ status: "active", reason: "😀".repeat(500) }).success).toBe(true);
    for (const reason of [undefined, "", "  ", "a".repeat(501), null]) {
      expect(fieldsOf(PlatformOrgSetStatusRequest.safeParse({ status: "active", reason })), String(reason)).toEqual(["reason"]);
    }
    expect(fieldsOf(PlatformOrgSetStatusRequest.safeParse({ reason: "x" }))).toEqual(["status"]);
    expect(fieldsOf(PlatformOrgSetStatusRequest.safeParse({ status: "deleted", reason: "x" }))).toEqual(["status"]);
    expect(fieldsOf(PlatformOrgSetStatusRequest.safeParse({ status: "active", reason: "x", note: "y" }))).toEqual(["note"]);
  });
});

describe("platform DTOs", () => {
  const organization = {
    id: A,
    slug: "shop",
    displayName: "ร้าน",
    legalName: null,
    taxId: null,
    phone: null,
    logoFileId: null,
    receiptFooter: null,
    status: "active",
    createdAt: AT,
    updatedAt: AT,
  };
  const detail = {
    organization,
    subscription: {
      plan: { code: "mvp_free", name: "Free", maxBranches: 1, maxStaff: null, priceSatangPerMonth: 0, isActive: true },
      startedAt: AT,
      currentPeriodEnd: null,
      note: null,
    },
    usage: { branches: 1, staff: { active: 1, pendingInvitations: 0, total: 1 } },
    owners: [{ userId: A, displayName: "Owner", email: null, username: "owner.one" }],
  };

  it("parse the spec shapes", () => {
    expect(PlatformOrgDetail.parse(detail)).toEqual(detail);
    const summary = {
      id: A,
      slug: "shop",
      displayName: "ร้าน",
      status: "suspended",
      plan: { code: "c", name: "n" },
      usage: { branches: 2, staff: 3 },
      createdAt: AT,
    };
    expect(PlatformOrgListResponse.parse({ items: [summary], nextCursor: null })).toEqual({ items: [summary], nextCursor: null });
  });

  it("reject extra keys", () => {
    expect(PlatformOrgDetail.safeParse({ ...detail, extra: 1 }).success).toBe(false);
    expect(PlatformOrgDetail.safeParse({ ...detail, owners: [{ ...detail.owners[0], role: "owner" }] }).success).toBe(false);
  });
});
