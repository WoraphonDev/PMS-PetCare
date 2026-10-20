#!/usr/bin/env node
// Lists the questions in docs/questions/ (one file per question) and checks their format.
// Usage: node scripts/questions-index.mjs [--open] [--check] [dir]
//   --open   only questions whose Status is open
//   --check  validate every file (id = filename, heading, Status, Raised by); exit 1 on errors
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ID_RE = /^(Q-\d{4}|(?:T|ADR)-\d{4}-\d{2})$/;
const STATUS_RE = /^(open|answered|wontfix)\b/;

export function parseQuestion(file, text) {
  const id = file.replace(/\.md$/, "");
  const errors = [];
  if (!ID_RE.test(id)) errors.push(`${file}: name must be T-NNNN-NN.md, ADR-NNNN-NN.md or legacy Q-NNNN.md`);
  const heading = text.match(/^# (\S+) · (.+)$/m);
  if (!heading || text.split("\n")[0] !== heading[0]) errors.push(`${file}: first line must be "# ${id} · <title>"`);
  else if (heading[1] !== id) errors.push(`${file}: heading id ${heading[1]} does not match file name`);
  const status = text.match(/^- Status: (.+)$/m)?.[1]?.trim();
  if (!status || !STATUS_RE.test(status)) errors.push(`${file}: "- Status: open | answered | wontfix" missing or invalid`);
  const raised = text.match(/^- Raised by: (.+)$/m)?.[1];
  if (!raised) errors.push(`${file}: "- Raised by:" missing`);
  const card = raised?.match(/\b(T-\d{4}|ADR-\d{4})\b/)?.[1] ?? "";
  return { id, title: heading?.[2] ?? "", status: status ?? "", card, errors };
}

export function loadQuestions(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => parseQuestion(f, readFileSync(join(dir, f), "utf8")));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? "docs/questions";
  const qs = loadQuestions(dir);
  if (args.includes("--check")) {
    const errors = qs.flatMap((q) => q.errors);
    if (errors.length) {
      console.error(`questions check FAILED:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`questions check OK — ${qs.length} file(s)`);
  } else {
    const shown = args.includes("--open") ? qs.filter((q) => q.status.startsWith("open")) : qs;
    console.log("| id | status | card | title |\n|---|---|---|---|");
    for (const q of shown) console.log(`| ${q.id} | ${q.status} | ${q.card} | ${q.title} |`);
  }
}
