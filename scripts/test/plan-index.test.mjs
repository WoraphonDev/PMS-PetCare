import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { checkCards, loadCards, parseCard, renderCards } from "../plan-index.mjs";
import { SCRIPTS } from "./helpers.mjs";

const card = (id, deps = "[]", extra = "") =>
  `---\nid: ${id}\ntitle: "A | title"\nlane: infra\nowner: agent\nhuman_review: false\ndepends_on: ${deps}\n${extra}---\n# body\n`;
test("card parser reads front matter; CRLF supported", () => {
  const c = parseCard("T-0099.md", card("T-0099", "[T-0001, T-0002]").replaceAll("\n", "\r\n"));
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.dependsOn, ["T-0001", "T-0002"]);
  assert.equal(c.humanReview, false);
});
test("bad or missing metadata fails, never silently dispatches", () => {
  assert.match(parseCard("T-0099.md", "---\nid: T-0099").errors.join(), /unclosed/);
  assert.match(parseCard("T-0099.md", card("T-0001")).errors.join(), /id must/);
  assert.match(parseCard("T-0099.md", card("T-0099", "[bad]")).errors.join(), /invalid dependency/);
  assert.match(parseCard("T-0099.md", card("T-0099", "[T-0001, T-0001]")).errors.join(), /duplicate/);
  assert.match(parseCard("T-0099.md", card("T-0099").replace("human_review: false", "human_review: nope")).errors.join(), /human_review/);
});
test("dependency graph checks missing targets and cycles", () => {
  const a = parseCard("T-0001.md", card("T-0001", "[T-0002]"));
  const b = parseCard("T-0002.md", card("T-0002", "[T-0001]"));
  assert.match(checkCards([a]).join(), /has no card/);
  assert.match(checkCards([a, b]).join(), /cycle/);
  assert.deepEqual(checkCards([a, { ...b, dependsOn: [] }]), []);
});
test("table is a dependency index, not guessed merged/readiness status", () => {
  const output = renderCards([parseCard("T-0099.md", card("T-0099"))]);
  assert.match(output, /NOT completion or dispatch approval/);
  assert.match(output, /A \\\| title/);
  assert.match(output, /T-0099/);
});
test("repository cards form a valid graph", () => {
  const cards = loadCards(join(SCRIPTS, "..", "docs/tasks"));
  assert.ok(cards.length > 0);
  assert.deepEqual(checkCards(cards), []);
});
