import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

const CARD = `---
id: T-0099
owner: agent
allowed_paths:
  - "apps/api/src/x/**"
---

# T-0099

## Status log
`;

function setup(changes) {
  const r = tempRepo();
  r.write({
    "docs/tasks/T-0099.md": CARD,
    "docs/tasks/T-0098.md": CARD.replaceAll("0099", "0098"),
    "docs/questions/Q-0001.md": "# Q-0001 · x\n",
  });
  r.commit("base");
  r.git("checkout", "-q", "-b", "t-0099-fixture");
  changes(r);
  r.commit("change");
  return r.run("node", [join(SCRIPTS, "check-task-scope.mjs")], { BASE_REF: "main" });
}

test("passes: allowed path + own question file + own log", () => {
  const res = setup((r) =>
    r.write({ "apps/api/src/x/a.ts": "1\n", "docs/questions/T-0099-01.md": "q\n", "docs/tasks/log/T-0099.md": "log\n" }),
  );
  assert.equal(res.code, 0, res.out);
});

test("fails: the card itself is human-only, even the Status log section", () => {
  const res = setup((r) => r.write({ "docs/tasks/T-0099.md": `${CARD}2026-10-20 · claude · did things\n` }));
  assert.equal(res.code, 1);
  assert.match(res.out, /written by humans only/);
});

test("fails: another card's question file, a legacy question, or another card's log", () => {
  const res = setup((r) =>
    r.write({ "docs/questions/T-0098-01.md": "q\n", "docs/questions/Q-0001.md": "edited\n", "docs/tasks/log/T-0098.md": "log\n" }),
  );
  assert.equal(res.code, 1);
  assert.match(res.out, /docs\/questions\/T-0098-01\.md: write questions only as docs\/questions\/T-0099-NN\.md/);
  assert.match(res.out, /docs\/questions\/Q-0001\.md: write questions only/);
  assert.match(res.out, /docs\/tasks\/log\/T-0098\.md: other task cards and logs are read-only/);
});

test("fails: the old shared docs/questions.md is no longer writable", () => {
  const res = setup((r) => r.write({ "docs/questions.md": "## Q-0018 · x\n" }));
  assert.equal(res.code, 1);
  assert.match(res.out, /docs\/questions\.md: write questions only/);
});

test("fails: a question file name that is not <card>-NN.md", () => {
  const res = setup((r) => r.write({ "docs/questions/T-0099-1.md": "q\n" }));
  assert.equal(res.code, 1);
});
