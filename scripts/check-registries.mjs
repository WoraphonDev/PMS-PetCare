#!/usr/bin/env node
// Registry files (barrel exports, Nest module list) are edited by many cards in parallel. One entry per line in
// alphabetical order means two branches adding different entries touch different lines, so git merges them itself.
// Usage: node scripts/check-registries.mjs
import { readFileSync } from "node:fs";

export const REGISTRIES = [
  { file: "packages/db/src/schema/index.ts", kind: "barrel" },
  { file: "packages/contracts/src/index.ts", kind: "barrel" },
  { file: "apps/api/src/create-app.ts", kind: "modules" },
];

const unsorted = (keys) => keys.findIndex((k, i) => i > 0 && keys[i - 1].localeCompare(k, "en") > 0);

/** @returns {string[]} problems found in one registry file */
export function checkRegistry(kind, text) {
  const errors = [];
  if (kind === "barrel") {
    const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("//"));
    const keys = [];
    for (const line of lines) {
      const m = line.match(/^export (?:\*|\{[^}]*\}) from "([^"]+)";$/);
      if (m) keys.push(m[1]);
      else errors.push(`not a one-line "export … from" entry: ${line}`);
    }
    const i = unsorted(keys);
    if (i > 0) errors.push(`exports not sorted by path: "${keys[i]}" must come before "${keys[i - 1]}"`);
  } else if (kind === "modules") {
    const block = text.match(/^(\s*)imports: \[\n([\s\S]*?)\n\1\],$/m);
    if (!block) return ["module list must be written as `imports: [` + one module per line + `],`"];
    const entries = block[2].split("\n").map((l) => l.trim());
    const keys = [];
    for (const e of entries) {
      if (!e.endsWith(",")) errors.push(`module entry needs a trailing comma: ${e}`);
      else if (!/^(\.\.\.)?[A-Za-z_$][\w$.]*,$/.test(e)) errors.push(`one module per line: ${e}`);
      if (!e.startsWith("...")) keys.push(e.replace(/,$/, ""));
    }
    if (entries.findIndex((e) => e.startsWith("...")) !== -1 && !entries.at(-1).startsWith("..."))
      errors.push("spread entries (…extra) go last");
    const i = unsorted(keys);
    if (i > 0) errors.push(`modules not sorted: "${keys[i]}" must come before "${keys[i - 1]}"`);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = REGISTRIES.flatMap(({ file, kind }) => checkRegistry(kind, readFileSync(file, "utf8")).map((e) => `${file}: ${e}`));
  if (errors.length) {
    console.error(`registry check FAILED (one entry per line, alphabetical):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`registry check OK — ${REGISTRIES.length} file(s) sorted, one entry per line`);
}
