#!/usr/bin/env node
// Read gh api --paginate --slurp issue-comment pages. Never trust event.before as an approval anchor.
import { readFileSync } from "node:fs";
export function approvedHead(pages) {
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) return null;
  let selected = null;
  for (const comment of pages.flat()) {
    if (comment?.user?.login !== "github-actions[bot]" || comment?.user?.type !== "Bot") continue;
    const match = typeof comment.body === "string" && comment.body.match(/^<!-- pms-agent-approved-sha:([0-9a-f]{40}) -->$/);
    if (match && Number.isSafeInteger(comment.id) && (!selected || comment.id > selected.id)) selected = { id: comment.id, sha: match[1] };
  }
  return selected?.sha ?? null;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const sha = approvedHead(JSON.parse(readFileSync(process.argv[2], "utf8")));
  if (!sha) process.exit(1);
  console.log(sha);
}
