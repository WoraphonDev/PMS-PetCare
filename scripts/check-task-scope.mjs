#!/usr/bin/env node
// CI guard: a task PR (branch t-NNNN-slug) may only change files allowed by its card docs/tasks/T-NNNN.md.
// Usage: TASK_ID=T-0012 BASE_REF=origin/main node scripts/check-task-scope.mjs
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const branch = process.env.GITHUB_HEAD_REF || sh("git rev-parse --abbrev-ref HEAD");
let taskId = process.env.TASK_ID;
if (!taskId) {
  const m = branch.match(/^t-(\d{4})-/);
  if (!m) {
    console.log(`branch "${branch}" is not a task branch (t-NNNN-slug) → scope check skipped; non-task PRs need human review.`);
    process.exit(0);
  }
  taskId = `T-${m[1]}`;
}
const card = `docs/tasks/${taskId}.md`;
if (!existsSync(card)) {
  console.error(`card ${card} not found`);
  process.exit(1);
}
const front = readFileSync(card, "utf8").split("\n---")[0];
const allowed = [...front.matchAll(/^\s+- "(.+)"$/gm)].map((m) => m[1]);
if (/^owner: human/m.test(front)) {
  console.error(`${taskId} is a human task — agents must not open PRs for it`);
  process.exit(1);
}
const base = process.env.BASE_REF || "origin/main";
const mergeBase = sh(`git merge-base ${base} HEAD`);
const changes = sh(`git diff --name-status ${mergeBase} HEAD`)
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const parts = l.split("\t");
    return { status: parts[0][0], file: parts[parts.length - 1], from: parts.length === 3 ? parts[1] : null };
  });

const toRe = (glob) => {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${esc
      .split("**")
      .map((part) => part.replaceAll("*", "[^/]*"))
      .join(".*")}$`,
  );
};
const allowRes = allowed.map(toRe);
const FORBIDDEN = [
  [/^docs\/spec\//, "spec is read-only"],
  [/^docs\/adr\//, "ADRs are decided by humans"],
  [/(^|\/)(AGENTS|CLAUDE)\.md$/, "agent instructions are read-only"],
  [/^\.(claude|codex)\//, "agent settings are read-only"],
  [/^\.github\//, "CI config is read-only"],
  [/^scripts\//, "guard scripts are read-only"],
  [/(^|\/)\.env(\.|$)(?!example$)/, "never commit .env files"],
];
const violations = [];
for (const { status, file, from } of changes) {
  if (from) violations.push(`${file}: renames are not allowed in task PRs (from ${from})`);
  if (file === "docs/questions.md") continue;
  if (file === card) {
    const cut = "## Status log";
    const before = sh(`git show ${mergeBase}:${card}`).split(cut)[0];
    if (readFileSync(card, "utf8").split(cut)[0] !== before) violations.push(`${card}: only the '${cut}' section may change`);
    continue;
  }
  const forb = FORBIDDEN.find(([re]) => re.test(file));
  if (forb) {
    violations.push(`${file}: ${forb[1]}`);
    continue;
  }
  if (file.startsWith("docs/tasks/")) {
    violations.push(`${file}: other task cards are read-only`);
    continue;
  }
  if (/\/migrations\//.test(file) && status !== "A") {
    violations.push(`${file}: merged migrations are immutable (status ${status})`);
    continue;
  }
  if (!allowRes.some((re) => re.test(file))) violations.push(`${file}: not in allowed_paths of ${taskId}`);
}
if (violations.length) {
  console.error(`task scope FAILED for ${taskId} (${changes.length} changed files):`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    `allowed_paths:\n${allowed.map((a) => `  ${a}`).join("\n")}\nIf you really need another file: stop and write docs/questions.md.`,
  );
  process.exit(1);
}
console.log(`task scope OK — ${taskId}: ${changes.length} changed file(s) all within allowed_paths`);
