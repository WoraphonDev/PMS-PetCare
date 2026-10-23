import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AuditListQuery, AuditListResponse, SubscriptionGetResponse } from "../index";

// docs/spec/features/foundation.md#contract-audit-list (T-0018-01 B, T-0018-04 A) · #contract-subscription-get · §6
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join(".") || "_");
const A = "6f1c2a8e-4b7d-4e2a-9c3b-1d2e3f4a5b6c";

describe("AuditListQuery", () => {
  it("accepts no filter at all, and every filter alone (T-0018-04 A)", () => {
    expect(AuditListQuery.parse({})).toEqual({});
    expect(AuditListQuery.parse({ from: "2031-05-06T00:00:00Z" })).toEqual({ from: "2031-05-06T00:00:00Z" });
    expect(AuditListQuery.parse({ to: "2031-05-06T07:00:00.123456+07:00" })).toEqual({ to: "2031-05-06T07:00:00.123456+07:00" });
    expect(AuditListQuery.parse({ action: "staff.removed" })).toEqual({ action: "staff.removed" });
    expect(AuditListQuery.parse({ actorUserId: A.toUpperCase() })).toEqual({ actorUserId: A });
    expect(AuditListQuery.parse({ cursor: "abc.def" })).toEqual({ cursor: "abc.def" });
  });

  it("rejects impossible calendar instants at their own field, even next to a valid bound (no throw)", () => {
    for (const bad of [
      "2031-13-06T00:00:00Z",
      "2031-02-30T00:00:00Z",
      "2031-04-31T00:00:00Z",
      "2030-02-29T00:00:00Z",
      "2031-05-06T24:00:00Z",
      "2031-05-06T00:60:00Z",
      // Rejected by Postgres 17 (checked): year 0000, offsets of 16 hours or more, offset minutes of 60.
      "0000-01-01T00:00:00Z",
      "2031-05-06T00:00:00+16:00",
      "2031-05-06T00:00:00-1600",
      "2031-05-06T00:00:00+07:60",
    ]) {
      expect(fieldsOf(AuditListQuery.safeParse({ from: bad, to: "2032-01-01T00:00:00Z" })), bad).toEqual(["from"]);
      expect(fieldsOf(AuditListQuery.safeParse({ from: "2031-01-01T00:00:00Z", to: bad })), bad).toEqual(["to"]);
    }
    // The edges Postgres accepts: years 0001–9999, offsets up to ±15:59.
    for (const ok of [
      "2032-02-29T00:00:00Z",
      "0001-01-01T00:00:00Z",
      "9999-12-31T23:59:59.999999Z",
      "2031-05-06T00:00:00+15:59",
      "2031-05-06T00:00:00-1559",
      "2031-05-06T00:00:00+0730",
    ])
      expect(AuditListQuery.safeParse({ from: ok }).success, ok).toBe(true);
  });

  it("compares from/to at microsecond precision, like Postgres (no millisecond rounding)", () => {
    expect(AuditListQuery.safeParse({ from: "2031-05-06T00:00:00.000100Z", to: "2031-05-06T00:00:00.000900Z" }).success).toBe(true);
    expect(AuditListQuery.safeParse({ from: "2031-05-06T07:00:00.0001+07:00", to: "2031-05-06T00:00:00.0002Z" }).success).toBe(true);
    for (const [from, to] of [
      ["2031-05-06T00:00:00.000500Z", "2031-05-06T00:00:00.0005Z"],
      ["2031-05-06T00:00:00.0009Z", "2031-05-06T00:00:00.0001Z"],
      ["2031-05-06T00:00:00.0000001Z", "2031-05-06T00:00:00Z"],
    ])
      expect(fieldsOf(AuditListQuery.safeParse({ from, to })), `${from} ${to}`).toEqual(["to"]);
    // 366 days and one microsecond is too long.
    expect(fieldsOf(AuditListQuery.safeParse({ from: "2031-01-01T00:00:00Z", to: "2032-01-02T00:00:00.000001Z" }))).toEqual(["to"]);
  });

  it("requires from < to and at most 366 days when both are sent", () => {
    const ok = AuditListQuery.safeParse({ from: "2031-01-01T00:00:00Z", to: "2032-01-02T00:00:00Z" });
    expect(ok.success).toBe(true); // 366 days exactly (2031 is not a leap year: 365 + 1)
    for (const [from, to] of [
      ["2031-05-06T00:00:00Z", "2031-05-06T00:00:00Z"],
      ["2031-05-07T00:00:00Z", "2031-05-06T00:00:00Z"],
      ["2031-01-01T00:00:00Z", "2032-01-02T00:00:00.001Z"],
    ]) {
      expect(fieldsOf(AuditListQuery.safeParse({ from, to })), `${from} ${to}`).toEqual(["to"]);
    }
  });

  it("rejects non-instants, local dates, unknown actions, bad ids, repeated keys and unknown keys", () => {
    for (const [query, field] of [
      [{ from: "2031-05-06" }, "from"],
      [{ to: "yesterday" }, "to"],
      [{ from: "2031-05-06T00:00:00" }, "from"],
      [{ action: "staff.updated" }, "action"],
      [{ action: ["staff.removed", "org.updated"] }, "action"],
      [{ actorUserId: "x" }, "actorUserId"],
      [{ cursor: "" }, "cursor"],
      [{ cursor: "x".repeat(513) }, "cursor"],
      [{ page: "2" }, "page"],
      [{ orgId: A }, "orgId"],
    ] as const) {
      expect(fieldsOf(AuditListQuery.safeParse(query)), JSON.stringify(query)).toContain(field);
    }
  });

  it("knows exactly the §6 actions", () => {
    expect(AUDIT_ACTIONS).toEqual([
      "org.updated",
      "branch.created",
      "branch.updated",
      "branch.payment_settings_updated",
      "staff.invited",
      "staff.joined",
      "staff.account_created",
      "staff.password_reset",
      "staff.role_changed",
      "staff.removed",
      "auth.password_reset",
      "auth.two_factor_enabled",
      "auth.two_factor_disabled",
      "platform.org_status_changed",
      "platform.plan_changed",
      "platform.org_viewed",
    ]);
  });
});

describe("response shapes", () => {
  it("AuditListResponse: items without ip/userAgent, actor nullable", () => {
    const item = {
      id: A,
      occurredAt: "2031-05-06T07:08:09.123Z",
      action: "staff.removed",
      entityType: "membership",
      entityId: A,
      actor: { userId: A, displayName: "Mai" },
      before: { status: "active" },
      after: null,
    };
    expect(AuditListResponse.safeParse({ items: [item, { ...item, actor: null }], nextCursor: null }).success).toBe(true);
    expect(AuditListResponse.safeParse({ items: [{ ...item, ip: "1.2.3.4" }], nextCursor: null }).success).toBe(false);
    expect(AuditListResponse.safeParse({ items: [{ ...item, userAgent: "x" }], nextCursor: "c" }).success).toBe(false);
  });

  it("SubscriptionGetResponse: no note, no plan isActive, null limits allowed", () => {
    const body = {
      plan: { code: "free", name: "Free", maxBranches: null, maxStaff: 5, priceSatangPerMonth: 0 },
      startedAt: "2031-05-06T07:08:09.123Z",
      currentPeriodEnd: null,
      usage: { branches: 1, staff: { active: 1, pendingInvitations: 0, total: 1 } },
    };
    expect(SubscriptionGetResponse.safeParse(body).success).toBe(true);
    expect(SubscriptionGetResponse.safeParse({ ...body, note: "x" }).success).toBe(false);
    expect(SubscriptionGetResponse.safeParse({ ...body, plan: { ...body.plan, isActive: true } }).success).toBe(false);
  });
});
