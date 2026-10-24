import { describe, expect, it } from "vitest";
import { bangkokDayStartUtc, formatDate, formatDateTime } from "../../src/lib/format";

describe("date helpers (F06)", () => {
  it("bangkokDayStartUtc: 00:00 Bangkok as a UTC instant", () => {
    expect(bangkokDayStartUtc("2026-10-24")).toBe("2026-10-23T17:00:00.000Z");
    expect(() => bangkokDayStartUtc("24/10/2026")).toThrow(RangeError);
  });

  it("formatDate: Buddhist year, Bangkok day — a local date and an instant past 17:00 UTC", () => {
    expect(formatDate("2026-10-24")).toContain("2569");
    expect(formatDate("2026-10-24")).toContain("24");
    // 2026-12-31 18:00 UTC is already 1 Jan 2027 (พ.ศ. 2570) in Bangkok.
    expect(formatDate("2026-12-31T18:00:00.000Z")).toMatch(/^1 .*2570$/);
  });

  it("formatDateTime: Bangkok wall clock", () => {
    expect(formatDateTime("2026-10-24T03:05:00.000Z")).toContain("10:05");
    expect(formatDateTime("2026-10-24T03:05:00.000Z")).toContain("2569");
  });
});
