import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const valid = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgres://app_runtime:s3cr3t-db-pass@db:5432/pms",
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
