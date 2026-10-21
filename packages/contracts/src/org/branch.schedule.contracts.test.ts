import { describe, expect, it } from "vitest";
import {
  BRANCH_CLOSURE_CREATE_STATUS,
  BRANCH_CLOSURE_DELETE_STATUS,
  BRANCH_HOURS_PUT_STATUS,
  BranchClosureCreateRequest,
  BranchClosureListResponse,
  BranchClosureParams,
  BranchHoursPutRequest,
  BranchHoursPutResponse,
  Closure,
  LocalDate,
  ScheduleQuery,
} from "../index";

// docs/spec/features/foundation.md#contract-branch-schedule-common · #contract-branch-hours · #contract-branch-closures ·
// #rule-branch-closure-calendar
const fieldsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join("."));

const day = (weekday: number, opensAt: string | null = "09:00", closesAt: string | null = "18:00") => ({ weekday, opensAt, closesAt });
const week = () => [1, 2, 3, 4, 5, 6, 7].map((w) => day(w));
const withItem = (index: number, item: unknown) => ({ items: week().map((d, i) => (i === index ? item : d)) });

describe("BranchHoursPutRequest", () => {
  it("accepts seven days in any order, all closed and mixed schedules", () => {
    const shuffled = [7, 3, 1, 5, 2, 6, 4].map((w) => day(w, w === 7 ? null : "00:00", w === 7 ? null : "23:59"));
    expect(BranchHoursPutRequest.parse({ items: shuffled })).toEqual({ items: shuffled });
    expect(BranchHoursPutRequest.safeParse({ items: [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, null, null)) }).success).toBe(true);
  });

  it("requires exactly seven items, reported on items", () => {
    expect(fieldsOf(BranchHoursPutRequest.safeParse({ items: week().slice(0, 6) }))).toContain("items");
    expect(fieldsOf(BranchHoursPutRequest.safeParse({ items: [...week(), day(1)] }))).toContain("items");
    expect(fieldsOf(BranchHoursPutRequest.safeParse({ items: [] }))).toContain("items");
  });

  it("rejects duplicate, 0, 8, fractional and non-number weekdays on items.<i>.weekday", () => {
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(6, day(1))))).toContain("items.6.weekday");
    for (const weekday of [0, 8, 1.5, "1", null, -1]) {
      expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(0, { ...day(1), weekday }))), String(weekday)).toContain("items.0.weekday");
    }
  });

  it("requires both time keys, both null or both HH:mm with opensAt < closesAt", () => {
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(2, day(3, null, "18:00"))))).toContain("items.2.opensAt");
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(2, day(3, "09:00", null))))).toContain("items.2.closesAt");
    for (const [opensAt, closesAt] of [
      ["09:00", "09:00"],
      ["18:00", "09:00"],
      ["22:00", "02:00"],
    ]) {
      expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(2, day(3, opensAt, closesAt))))).toContain("items.2.closesAt");
    }
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(0, { weekday: 1, closesAt: "18:00" })))).toContain("items.0.opensAt");
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(0, { weekday: 1, opensAt: "09:00" })))).toContain("items.0.closesAt");
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(0, { opensAt: "09:00", closesAt: "18:00" })))).toContain("items.0.weekday");
  });

  it("accepts only ASCII HH:mm 00:00-23:59 (lexical boundaries, no seconds, offsets, whitespace or 24:00)", () => {
    expect(BranchHoursPutRequest.safeParse(withItem(0, day(1, "00:00", "00:01"))).success).toBe(true);
    expect(BranchHoursPutRequest.safeParse(withItem(0, day(1, "23:58", "23:59"))).success).toBe(true);
    expect(BranchHoursPutRequest.safeParse(withItem(0, day(1, "09:59", "10:00"))).success).toBe(true);
    for (const bad of ["24:00", "9:00", "09:0", "09:00:00", "09:00:00.5", "09:00Z", "09:00+07:00", " 09:00", "09:00 ", "09:60", "0９:00", "", 900]) {
      expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(0, day(1, bad as string, "23:59")))), String(bad)).toContain(
        "items.0.opensAt",
      );
    }
  });

  it("rejects wrong body types and reports nested and prototype-like unknown keys by dotted path", () => {
    for (const body of [null, [], "x", 1, {}]) expect(BranchHoursPutRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    expect(fieldsOf(BranchHoursPutRequest.safeParse({}))).toContain("items");
    expect(fieldsOf(BranchHoursPutRequest.safeParse({ items: null }))).toContain("items");
    expect(fieldsOf(BranchHoursPutRequest.safeParse({ items: week(), branchId: "x" }))).toContain("branchId");
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(4, { ...day(5), id: "x" })))).toContain("items.4.id");
    for (const key of ["toString", "constructor", "__proto__", "orgId"]) {
      const item = JSON.parse(`{"weekday":5,"opensAt":"09:00","closesAt":"18:00","${key}":1}`);
      expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(4, item))), key).toContain(`items.4.${key}`);
    }
    expect(fieldsOf(BranchHoursPutRequest.safeParse(withItem(1, null)))).toContain("items.1");
  });

  it("describes the 200 response as the exact sorted projection", () => {
    expect(BRANCH_HOURS_PUT_STATUS).toBe(200);
    expect(BranchHoursPutResponse.safeParse({ items: week() }).success).toBe(true);
    expect(BranchHoursPutResponse.safeParse({ items: [{ ...day(1), id: "x" }] }).success).toBe(false);
  });
});

describe("LocalDate (G3)", () => {
  it("accepts real proleptic Gregorian dates in years 0001-9999", () => {
    for (const ok of ["0001-01-01", "0099-12-31", "0100-03-01", "9999-12-31", "2000-02-29", "2024-02-29", "1600-02-29", "2026-10-22"]) {
      expect(LocalDate.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejects invalid calendar dates, year 0000, expanded/BC/infinity, datetimes, offsets and whitespace", () => {
    for (const bad of [
      "1900-02-29",
      "2023-02-29",
      "2100-02-29",
      "0100-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-01-00",
      "2026-01-32",
      "0000-01-01",
      "+10000-01-01",
      "-0001-01-01",
      "+2026-01-01",
      "2026-01-01 BC",
      "infinity",
      "-infinity",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00",
      "2026-01-01+07:00",
      " 2026-01-01",
      "2026-01-01 ",
      "2026-1-01",
      "26-01-01",
      "２026-01-01",
      "",
      20260101,
      null,
    ]) {
      expect(LocalDate.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("BranchClosureCreateRequest", () => {
  it("accepts single and multi-day ranges; omitted or null reason becomes null; reason is trimmed", () => {
    expect(BranchClosureCreateRequest.parse({ startDate: "2026-12-31", endDate: "2026-12-31" })).toEqual({
      startDate: "2026-12-31",
      endDate: "2026-12-31",
      reason: null,
    });
    expect(BranchClosureCreateRequest.parse({ startDate: "2026-12-30", endDate: "2027-01-02", reason: null }).reason).toBeNull();
    expect(BranchClosureCreateRequest.parse({ startDate: "2026-12-30", endDate: "2027-01-02", reason: "  ปีใหม่ \n" }).reason).toBe(
      "ปีใหม่",
    );
  });

  it("reports a reversed range on endDate", () => {
    expect(fieldsOf(BranchClosureCreateRequest.safeParse({ startDate: "2026-01-02", endDate: "2026-01-01" }))).toEqual(["endDate"]);
  });

  it("measures reason in code points 1-500 and rejects blank, U+0000 and lone surrogates", () => {
    const base = { startDate: "2026-01-01", endDate: "2026-01-01" };
    expect(BranchClosureCreateRequest.safeParse({ ...base, reason: "😀".repeat(500) }).success).toBe(true);
    expect(BranchClosureCreateRequest.safeParse({ ...base, reason: "a".repeat(500) }).success).toBe(true);
    expect(BranchClosureCreateRequest.safeParse({ ...base, reason: ` ${"a".repeat(500)} ` }).success).toBe(true);
    for (const bad of ["", "   ", "　", "a".repeat(501), "😀".repeat(501), "a\u0000b", "a\ud800b", "\udc00", 5, true]) {
      expect(fieldsOf(BranchClosureCreateRequest.safeParse({ ...base, reason: bad })), JSON.stringify(bad)).toContain("reason");
    }
  });

  it("requires both dates and rejects unknown, system and tenant keys", () => {
    expect(fieldsOf(BranchClosureCreateRequest.safeParse({ endDate: "2026-01-01" }))).toContain("startDate");
    expect(fieldsOf(BranchClosureCreateRequest.safeParse({ startDate: "2026-01-01" }))).toContain("endDate");
    expect(fieldsOf(BranchClosureCreateRequest.safeParse({ startDate: "2026-01-01", endDate: null }))).toContain("endDate");
    for (const key of ["id", "branchId", "orgId", "createdAt", "updatedAt", "version", "toString", "constructor"]) {
      const body = { startDate: "2026-01-01", endDate: "2026-01-01", [key]: "x" };
      expect(fieldsOf(BranchClosureCreateRequest.safeParse(body)), key).toContain(key);
    }
    for (const body of [null, [], "x"]) expect(BranchClosureCreateRequest.safeParse(body).success).toBe(false);
  });
});

describe("Closure DTO, list, params and query", () => {
  const closure = {
    id: "0b6b1b1c-6c3f-4c55-9a8a-1b7a1b3c9d10",
    branchId: "5f0d6a43-0e8a-4b8b-8c7e-3d5c0f5d9a21",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    reason: null,
    createdAt: "2026-10-22T03:04:05.678Z",
    updatedAt: "2026-10-22T03:04:05.678Z",
  };

  it("is the exact shape with reason always present and no orgId/version", () => {
    expect(Closure.parse(closure)).toEqual(closure);
    const { reason: _r, ...noReason } = closure;
    expect(Closure.safeParse(noReason).success).toBe(false);
    expect(Closure.safeParse({ ...closure, orgId: closure.branchId }).success).toBe(false);
    expect(Closure.safeParse({ ...closure, version: 1 }).success).toBe(false);
    expect(BranchClosureListResponse.parse({ items: [closure] })).toEqual({ items: [closure] });
    expect(BranchClosureListResponse.safeParse({ items: [], nextCursor: null }).success).toBe(false);
    expect(BRANCH_CLOSURE_CREATE_STATUS).toBe(201);
    expect(BRANCH_CLOSURE_DELETE_STATUS).toBe(204);
  });

  it("validates path ids by name and accepts no query keys", () => {
    expect(BranchClosureParams.safeParse({ branchId: closure.branchId, closureId: closure.id }).success).toBe(true);
    expect(fieldsOf(BranchClosureParams.safeParse({ branchId: "x", closureId: "y" }))).toEqual(["branchId", "closureId"]);
    expect(ScheduleQuery.safeParse({}).success).toBe(true);
    expect(fieldsOf(ScheduleQuery.safeParse({ cursor: "1", page: ["1", "2"] }))).toEqual(["cursor", "page"]);
  });
});
