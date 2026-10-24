import { describe, expect, it } from "vitest";
import { slugFromShopName } from "../../src/features/auth/slug";

describe("slugFromShopName (T-0023 auto-fill)", () => {
  it.each([
    ["Happy Paws", "happy-paws"],
    ["  Happy   Paws - Bangna  ", "happy-paws-bangna"],
    ["Paws & Claws 24", "paws-claws-24"],
    ["ร้าน Happy Paws สาขา 2", "happy-paws-2"],
    ["--Cat--Dog--", "cat-dog"],
  ])("%s → %s", (name, slug) => {
    expect(slugFromShopName(name)).toBe(slug);
  });

  it("a Thai-only name (or under 3 characters) gives an empty slug", () => {
    expect(slugFromShopName("ร้านหมาแมว")).toBe("");
    expect(slugFromShopName("AB")).toBe("");
  });

  it("cuts to 40 characters without a trailing hyphen", () => {
    const slug = slugFromShopName(`${"a".repeat(39)} bcd`);
    expect(slug).toBe("a".repeat(39));
    expect(slugFromShopName("x".repeat(60))).toHaveLength(40);
  });
});
