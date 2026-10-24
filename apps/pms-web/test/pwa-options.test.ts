import { describe, expect, it } from "vitest";
import { pwaOptions } from "../src/pwa/options";

describe("pwaOptions", () => {
  it("prompts for updates and registers from the app (T-0022-02 A)", () => {
    expect(pwaOptions.registerType).toBe("prompt");
    expect(pwaOptions.injectRegister).toBe(false);
  });

  it("precaches only built asset types", () => {
    const patterns = pwaOptions.workbox.globPatterns;
    expect(patterns).toEqual(["**/*.{js,css,html,webmanifest,png}"]);
  });

  it("has no runtime caching at all — API data and sessions never enter the cache", () => {
    expect(pwaOptions.workbox.runtimeCaching ?? []).toEqual([]);
  });

  it("never answers /api navigations with the app shell", () => {
    const { navigateFallback, navigateFallbackDenylist } = pwaOptions.workbox;
    expect(navigateFallback).toBe("/index.html");
    const denied = (path: string) => navigateFallbackDenylist.some((re) => re.test(path));
    for (const path of ["/api", "/api/", "/api/v1/me", "/api/v1/staff?x=1"]) expect(denied(path), path).toBe(true);
    for (const path of ["/", "/settings/org", "/apiary", "/login"]) expect(denied(path), path).toBe(false);
  });

  it("has a Thai standalone manifest with 192/512 and maskable icons", () => {
    const { manifest } = pwaOptions;
    expect(manifest).toMatchObject({ lang: "th", display: "standalone", start_url: "/" });
    expect(manifest.icons.map((i) => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ""}`)).toEqual(["192x192", "512x512", "512x512 maskable"]);
  });
});
