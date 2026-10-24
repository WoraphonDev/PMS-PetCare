import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { SCRIPTS } from "./helpers.mjs";

// ADR-0002 rule 4 is enforced by Biome overrides in the root biome.json. A nested biome.json in a client workspace
// silently drops root overrides (their paths are resolved against the nested folder), so this test runs the real
// Biome on probe files at the real paths: it fails if the rule is missing, misconfigured or switched off.
const ROOT = join(SCRIPTS, "..");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");

/** Lints `source` as if it lived at `file`; returns the 1-based lines that broke noRestrictedImports. */
function restrictedLines(file, source) {
  const path = join(ROOT, file);
  const created = [];
  for (let dir = dirname(path); !existsSync(dir); dir = dirname(dir)) created.unshift(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  try {
    let out = "";
    try {
      out = execFileSync(BIOME, ["lint", "--max-diagnostics=200", relative(ROOT, path)], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    const name = file.split("/").at(-1).replace(/[.]/g, "\\.");
    const re = new RegExp(`${name}:(\\d+):\\d+ lint/style/noRestrictedImports`, "g");
    return [...out.matchAll(re)].map((m) => Number(m[1]));
  } finally {
    rmSync(path, { force: true });
    if (created.length) rmSync(created[0], { recursive: true, force: true });
  }
}

const IMPORTS = [
  'import { a } from "@app/db";',
  'import { b } from "@app/db/schema";',
  'import { c } from "../../api/src/config";',
  'import { d } from "@app/api";',
  'import { e } from "pg";',
  'import { f } from "drizzle-orm";',
  'import { g } from "@app/contracts";',
  'import { h } from "@app/domain";',
  'import { i } from "@app/domain/permissions";',
  'import { j } from "@app/api-client";',
  'import { k } from "@app/ui";',
  'import { l } from "./api";',
];
const SOURCE = `${IMPORTS.join("\n")}\nexport const all = [a, b, c, d, e, f, g, h, i, j, k, l];\n`;
const SERVER = [1, 2, 3, 4, 5, 6];
// CI always installs Biome; only a local run without `pnpm install` may skip.
const NO_BIOME = !existsSync(BIOME) && !process.env.CI && "biome not installed (run pnpm install)";

test("web apps may import only api-client, contracts, domain and ui", { skip: NO_BIOME }, () => {
  for (const file of ["apps/pms-web/src/__boundary_probe__.ts", "apps/pms-web/src/routes/__boundary_probe__.tsx"]) {
    assert.deepEqual(restrictedLines(file, SOURCE), SERVER, file);
  }
});

test("packages/api-client may import only contracts", { skip: NO_BIOME }, () => {
  assert.deepEqual(restrictedLines("packages/api-client/src/__boundary_probe__.ts", SOURCE), [...SERVER, 8, 9, 10, 11]);
});

test("packages/ui imports no internal package", { skip: NO_BIOME }, () => {
  assert.deepEqual(restrictedLines("packages/ui/src/__boundary_probe__.ts", SOURCE), [...SERVER, 7, 8, 9, 10, 11]);
});

test("client workspaces have no nested biome.json (it would drop the root boundary overrides)", () => {
  for (const dir of ["apps/pms-web", "apps/liff", "packages/api-client", "packages/ui"]) {
    assert.equal(existsSync(join(ROOT, dir, "biome.json")), false, `${dir}/biome.json`);
  }
});
