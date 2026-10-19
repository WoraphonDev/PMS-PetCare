// Verifies the biome guards on packages/domain/src (ADR-0002: no internal packages, no Node built-ins / I/O):
// correctness/noNodejsModules (every Node built-in, any form) + style/noRestrictedImports (@app/*, pg).
// Plain .mjs so it can use node:child_process without adding @types/node to the domain package.
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const biome = join(repoRoot, "node_modules/.bin/biome");

function guardDiagnostics(importLine) {
  const rel = `packages/domain/src/__import_guard_probe_${process.pid}_${Math.random().toString(36).slice(2)}.ts`;
  const binding = /import\s+(?:\{\s*)?(\w+)/.exec(importLine)[1];
  writeFileSync(join(repoRoot, rel), `${importLine}\nexport const probe = [${binding}];\n`);
  try {
    let output;
    try {
      output = execFileSync(biome, ["lint", rel], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      output = `${err.stdout}${err.stderr}`;
    }
    return (output.match(/lint\/(style\/noRestrictedImports|correctness\/noNodejsModules)/g) ?? []).length;
  } finally {
    rmSync(join(repoRoot, rel), { force: true });
  }
}

describe("packages/domain import guard", () => {
  it.each([
    'import { readFile } from "fs/promises";',
    'import { readFile } from "node:fs/promises";',
    'import { connect } from "node:http2";',
    'import { connect } from "http2";',
    'import { request } from "https";',
    'import { lookup } from "dns";',
    'import { Worker } from "node:worker_threads";',
    'import os from "os";',
    'import pg from "pg";',
    'import { z } from "@app/contracts";',
  ])("blocks %s", (line) => {
    expect(guardDiagnostics(line)).toBe(1);
  });

  it.each(['import { fixedClock } from "./clock";', 'import { z } from "zod";'])("allows %s", (line) => {
    expect(guardDiagnostics(line)).toBe(0);
  });
});
