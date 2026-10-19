import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "../src/index";

describe("fixedClock", () => {
  it("returns the same instant on every call", () => {
    const clock = fixedClock("2026-10-20T03:00:00.000Z");
    const a = clock.now();
    const b = clock.now();
    expect(a.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(b.toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });

  it("returns a fresh Date so callers cannot mutate the clock", () => {
    const clock = fixedClock("2026-10-20T03:00:00Z");
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });

  it("accepts an explicit offset", () => {
    expect(fixedClock("2026-10-20T10:00:00+07:00").now().toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });

  it.each(["", "not-a-date", "2026-10-20", "2026-10-20T03:00:00", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z"])(
    "throws on malformed ISO instant %j",
    (iso) => {
      expect(() => fixedClock(iso)).toThrow();
    },
  );
});

describe("systemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
