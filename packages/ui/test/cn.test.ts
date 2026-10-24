import { describe, expect, it } from "vitest";
import { cn } from "../src/index";

describe("cn", () => {
  it("joins conditional classes and drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, { c: true, d: false }, ["e"])).toBe("a c e");
  });

  it("lets the later Tailwind class win a conflict", () => {
    expect(cn("px-2 py-1 bg-primary", "px-4", "bg-destructive")).toBe("py-1 px-4 bg-destructive");
  });
});
