import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const valid = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgres://app_runtime:s3cr3t-db-pass@db:5432/pms",
  DATABASE_PLATFORM_URL: "postgres://app_platform:s3cr3t-db-pass@db:5432/pms",
  BETTER_AUTH_SECRET: "x".repeat(32),
  VALKEY_URL: "redis://valkey:6379",
};

describe("loadConfig", () => {
  it("parses a valid environment and applies defaults", () => {
    expect(loadConfig(valid)).toEqual({ ...valid, PORT: 3000, BUILD_SHA: "dev" });
  });

  it("coerces PORT", () => {
    expect(loadConfig({ ...valid, PORT: "8080" }).PORT).toBe(8080);
  });

  it("names the missing key and never prints values", () => {
    const { DATABASE_URL: _omit, ...env } = valid;
    expect(() => loadConfig({ ...env, VALKEY_URL: "redis://:valkey-secret@valkey:6379" })).toThrow(/DATABASE_URL/);
    try {
      loadConfig({ ...env, VALKEY_URL: "redis://:valkey-secret@valkey:6379" });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("valkey-secret");
    }
  });

  it("requires a session secret of at least 32 characters", () => {
    expect(() => loadConfig({ ...valid, BETTER_AUTH_SECRET: "short-secret-value" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects an invalid value without echoing it", () => {
    let message = "";
    try {
      loadConfig({ ...valid, APP_ORIGIN: "not a url s3cr3t" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/APP_ORIGIN/);
    expect(message).not.toContain("s3cr3t");
  });
});

it("accepts only an explicit IP/CIDR proxy allowlist", () => {
  expect(loadConfig(valid).TRUSTED_PROXY_CIDRS).toBeUndefined();
  expect(loadConfig({ ...valid, TRUSTED_PROXY_CIDRS: "10.0.0.0/24, ::1" }).TRUSTED_PROXY_CIDRS).toEqual(["10.0.0.0/24", "::1"]);
  for (const value of ["true", "1", "*", "", "10.0.0.0/99", "proxy.example.com"]) {
    expect(() => loadConfig({ ...valid, TRUSTED_PROXY_CIDRS: value })).toThrow(/TRUSTED_PROXY_CIDRS/);
  }
});
