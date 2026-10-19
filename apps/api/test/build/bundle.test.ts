import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const apiRoot = join(import.meta.dirname, "../..");
const dist = join(apiRoot, "dist");

beforeAll(() => {
  execFileSync("pnpm", ["run", "build"], { cwd: apiRoot, stdio: "pipe" });
}, 120_000);

const files = () => readdirSync(dist, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".js"));
const all = () => files().map((f) => readFileSync(join(dist, f), "utf8"));

describe("api bundle", () => {
  it("emits main.js and worker.js", () => {
    expect(existsSync(join(dist, "main.js"))).toBe(true);
    expect(existsSync(join(dist, "worker.js"))).toBe(true);
  });

  it("bundles workspace packages — no import of @app/* or .ts files remains", () => {
    for (const code of all()) {
      expect(code).not.toMatch(/from\s*["']@app\//);
      expect(code).not.toMatch(/import\(\s*["']@app\//);
      expect(code).not.toMatch(/from\s*["'][^"']+\.ts["']/);
    }
  });

  it("emits decorator metadata (Nest DI needs design:paramtypes)", () => {
    expect(all().join("\n")).toContain("design:paramtypes");
  });

  it("ships no source maps and nothing from .env files", () => {
    expect(readdirSync(dist, { recursive: true, encoding: "utf8" }).some((f) => f.endsWith(".map"))).toBe(false);
    const env = readFileSync(join(apiRoot, "../../.env.example"), "utf8");
    const values = env
      .split("\n")
      .filter((l) => /^[A-Z_]+=.+/.test(l))
      .map((l) => l.slice(l.indexOf("=") + 1))
      // connection strings / URLs (hosts, credentials) — enum literals like "development" legitimately appear in code
      .filter((v) => v.includes("://"));
    expect(values.length).toBeGreaterThan(0);
    for (const code of all()) for (const v of values) expect(code).not.toContain(v);
  });
});
