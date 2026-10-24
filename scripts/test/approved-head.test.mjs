import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { approvedHead } from "../approved-head.mjs";
import { SCRIPTS } from "./helpers.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const comment = (id, sha, user = { login: "github-actions[bot]", type: "Bot" }) => ({
  id,
  body: `<!-- pms-agent-approved-sha:${sha} -->`,
  user,
});
test("approval anchors come only from exact workflow-bot markers, newest id across pages", () => {
  assert.equal(approvedHead([[comment(4, A)], [comment(9, B), comment(2, A)]]), B);
  assert.equal(approvedHead([[comment(9, B, { login: "dev", type: "User" }), comment(1, A)]]), A);
  assert.equal(approvedHead([[{ ...comment(2, B), body: `${comment(2, B).body}\nmore text` }, comment(1, A)]]), A);
  assert.equal(approvedHead([[comment(2, "bad")]]), null);
  assert.equal(approvedHead([[comment(2, B, { login: "github-actions[bot]", type: "User" })]]), null);
  assert.equal(approvedHead([]), null);
  assert.equal(approvedHead({}), null);
});
test("workflow uses stored approval SHA, not the previous push, and pins eligible head", () => {
  const workflow = readFileSync(join(SCRIPTS, "..", ".github/workflows/auto-merge.yml"), "utf8");
  assert.doesNotMatch(workflow, /github\.event\.before/);
  assert.match(workflow, /scripts\/approved-head\.mjs/);
  assert.match(workflow, /same-pr-diff\.sh "\$APPROVED" "\$AFTER"/);
  assert.match(workflow, /--match-head-commit "\$APPROVED"/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /if: always\(\) && steps.same.outputs.same != 'true'/);
});
