#!/usr/bin/env node
// Generate a task/dependency index from cards; do not maintain another shared table in PLAN-foundation.md.
// Usage: node scripts/plan-index.mjs [--check]
// This is NOT a completion/readiness detector. Check merged implementation PRs and each card's decision gates.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ID_RE = /^T-\d{4}$/;
export function parseCard(file, text) {
  const id = file.replace(/\.md$/, "");
  const errors = [];
  const match = text.replaceAll("\r\n", "\n").match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { id, dependsOn: [], errors: [`${file}: missing or unclosed front matter`] };
  const field = (k) => match[1].match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"))?.[1]?.trim();
  if (field("id") !== id) errors.push(`${file}: front matter id must be ${id}`);
  const title = (field("title") ?? "").replace(/^"|"$/g, "");
  if (!title) errors.push(`${file}: title missing`);
  const deps = field("depends_on");
  if (deps === undefined || !/^\[.*\]$/.test(deps)) errors.push(`${file}: depends_on must be a [list]`);
  const dependsOn = (deps ?? "[]")
    .slice(1, -1)
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  for (const d of dependsOn) if (!ID_RE.test(d)) errors.push(`${file}: invalid dependency ${d}`);
  if (new Set(dependsOn).size !== dependsOn.length) errors.push(`${file}: duplicate dependency`);
  const humanReview = field("human_review");
  if (!["true", "false"].includes(humanReview)) errors.push(`${file}: human_review must be true or false`);
  const owner = field("owner");
  if (!["agent", "human"].includes(owner)) errors.push(`${file}: owner must be agent or human`);
  return { id, title, lane: field("lane") ?? "", owner, humanReview: humanReview === "true", dependsOn, errors };
}
export function loadCards(dir) {
  return readdirSync(dir)
    .filter((f) => /^T-\d{4}\.md$/.test(f))
    .sort()
    .map((f) => parseCard(f, readFileSync(join(dir, f), "utf8")));
}
export function checkCards(cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const errors = cards.flatMap((c) => c.errors);
  for (const c of cards) for (const d of c.dependsOn) if (!byId.has(d)) errors.push(`${c.id}: dependency ${d} has no card`);
  const active = new Set();
  const done = new Set();
  const visit = (id) => {
    if (active.has(id)) {
      errors.push(`dependency cycle at ${id}`);
      return;
    }
    if (done.has(id) || !byId.has(id)) return;
    active.add(id);
    for (const dep of byId.get(id).dependsOn) visit(dep);
    active.delete(id);
    done.add(id);
  };
  for (const c of cards) visit(c.id);
  return errors;
}
export function renderCards(cards) {
  const cell = (s) => s.replaceAll("|", "\\|");
  return [
    "Dependency index only — NOT completion or dispatch approval. Verify implementation PRs and decision gates.",
    "| card | title | lane | depends_on | owner | human_review |",
    "|---|---|---|---|---|---|",
    ...cards.map(
      (c) => `| ${c.id} | ${cell(c.title)} | ${c.lane} | ${c.dependsOn.join(", ") || "—"} | ${c.owner} | ${c.humanReview ? "yes" : "no"} |`,
    ),
  ].join("\n");
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--check")) {
    console.error("Usage: node scripts/plan-index.mjs [--check]");
    process.exit(1);
  }
  const cards = loadCards("docs/tasks");
  const errors = checkCards(cards);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(args.includes("--check") ? `plan check OK — ${cards.length} card(s)` : renderCards(cards));
}
