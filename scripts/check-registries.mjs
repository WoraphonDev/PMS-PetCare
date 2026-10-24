#!/usr/bin/env node
// Registry files (barrel exports, Nest module list) are edited by many cards in parallel. One entry per line in
// alphabetical order means two branches adding different entries touch different lines, so git merges them itself.
// Usage: node scripts/check-registries.mjs
import { existsSync, readFileSync } from "node:fs";

// `optional`: the file is created by a later card (T-0022 / T-0043); it is checked as soon as it exists.
export const REGISTRIES = [
  { file: "packages/db/src/schema/index.ts", kind: "barrel" },
  { file: "packages/contracts/src/index.ts", kind: "barrel" },
  { file: "apps/api/src/create-app.ts", kind: "modules" },
  { file: "packages/api-client/src/index.ts", kind: "block", optional: true },
  { file: "apps/pms-web/src/i18n/th/index.ts", kind: "block", optional: true },
];

export const BLOCK_START = "// registry:start";
export const BLOCK_END = "// registry:end";

const unsorted = (keys) => keys.findIndex((k, i) => i > 0 && keys[i - 1].localeCompare(k, "en") > 0);

/** @returns {string[]} problems found in one registry block file */
function checkBlocks(text) {
  // Files that mix code and a registry: every list that cards append to sits between the two marker comments.
  // Inside a block: one complete entry per line (ends with "," or ";"), sorted, no blank or comment lines.
  // Sorted by the line without quotes, so `"scr-auth-login": x,` sorts as scr-auth-login, after `common,`.
  const errors = [];
  let open = false;
  let blocks = 0;
  let entries = [];
  const key = (line) => line.replace(/["'`]/g, "");
  text.split("\n").forEach((raw, n) => {
    const line = raw.trim();
    if (line === BLOCK_START) {
      if (open) errors.push(`line ${n + 1}: "${BLOCK_START}" inside an open block`);
      open = true;
      blocks += 1;
      entries = [];
    } else if (line === BLOCK_END) {
      if (!open) errors.push(`line ${n + 1}: "${BLOCK_END}" without "${BLOCK_START}"`);
      const i = unsorted(entries.map(key));
      if (i > 0) errors.push(`entries not sorted: "${entries[i]}" must come before "${entries[i - 1]}"`);
      open = false;
    } else if (open) {
      if (!line || line.startsWith("//")) errors.push(`line ${n + 1}: no blank or comment lines inside a registry block`);
      else if (!/[,;]$/.test(line) || /[{([]$/.test(line.slice(0, -1)))
        errors.push(`line ${n + 1}: one complete entry per line, ending with "," or ";": ${line}`);
      else entries.push(line);
    }
  });
  if (open) errors.push(`"${BLOCK_START}" is never closed by "${BLOCK_END}"`);
  if (blocks === 0)
    errors.push(
      `no registry block: put the list that cards append to between "${BLOCK_START}" and "${BLOCK_END}" (one entry per line, sorted)`,
    );
  return errors;
}

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
  } else if (kind === "block") {
    return checkBlocks(text);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const present = REGISTRIES.filter(({ file, optional }) => !optional || existsSync(file));
  const errors = present.flatMap(({ file, kind }) => checkRegistry(kind, readFileSync(file, "utf8")).map((e) => `${file}: ${e}`));
  if (errors.length) {
    console.error(`registry check FAILED (one entry per line, alphabetical):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
  const waiting = REGISTRIES.length - present.length;
  console.log(`registry check OK — ${present.length} file(s) sorted, one entry per line${waiting ? ` (${waiting} not created yet)` : ""}`);
}
