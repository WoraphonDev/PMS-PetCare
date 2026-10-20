import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

// Fake reviewer CLIs: record that they ran, print a verdict. codex writes it to `-o <file>`, claude to stdout.
function setup({ verdict = "CLEAN", fail = "" } = {}) {
  const repo = tempRepo();
  repo.write({ "docs/tasks/T-0099.md": "---\nid: T-0099\n---\n", "a.txt": "base\n" });
  repo.commit("base");
  repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  repo.git("checkout", "-q", "-b", "t-0099-x");
  const bin = join(repo.dir, ".fakebin");
  mkdirSync(bin);
  const body = (name, writeOut) => `#!/bin/sh
echo ${name} >> "${bin}/called"
${fail === name ? "echo 'usage limit reached' >&2; exit 3" : ""}
${writeOut}
`;
  writeFileSync(join(bin, "codex"), body("codex", `while [ "$1" != "-o" ]; do shift; done; printf 'ok\\nVERDICT: ${verdict}\\n' > "$2"`));
  writeFileSync(join(bin, "claude"), body("claude", `printf 'ok\\nVERDICT: ${verdict}\\n'`));
  chmodSync(join(bin, "codex"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  const review = (...args) =>
    repo.run("bash", [join(SCRIPTS, "agent-review.sh"), "T-0099", "1", ...args], {
      PATH: `${bin}:${process.env.PATH}`,
      SKIP_FETCH: "1",
    });
  const called = () => {
    try {
      return readFileSync(join(bin, "called"), "utf8").trim();
    } catch {
      return "";
    }
  };
  const commitAs = (agent) => {
    repo.write({ "a.txt": `${Math.random()}\n` });
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", agent ? `change\n\nAgent: ${agent}` : "change");
  };
  return { repo, review, called, commitAs };
}

test("no Agent trailer → dev is claude → codex reviews", () => {
  const s = setup();
  s.commitAs(null);
  const r = s.review();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.called(), "codex");
});

test("Agent: claude → codex reviews", () => {
  const s = setup();
  s.commitAs("claude");
  assert.equal(s.review().code, 0);
  assert.equal(s.called(), "codex");
});

test("Agent: codex → claude reviews (fallback when Claude was near its limit)", () => {
  const s = setup();
  s.commitAs("codex");
  const r = s.review();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.called(), "claude");
});

test("CHANGES_REQUESTED → exit 2", () => {
  const s = setup({ verdict: "CHANGES_REQUESTED" });
  s.commitAs("codex");
  assert.equal(s.review().code, 2);
});

test("both agents committed → no independent reviewer → exit 1, nobody runs", () => {
  const s = setup();
  s.commitAs("claude");
  s.commitAs("codex");
  const r = s.review();
  assert.equal(r.code, 1);
  assert.match(r.out, /both agents/);
  assert.equal(s.called(), "");
});

test("explicit reviewer equal to the author is refused", () => {
  const s = setup();
  s.commitAs("codex");
  const r = s.review("codex");
  assert.equal(r.code, 1);
  assert.match(r.out, /also wrote this branch/);
  assert.equal(s.called(), "");
});

test("reviewer CLI failure (e.g. usage limit) → exit 1 with fallback hint", () => {
  const s = setup({ fail: "claude" });
  s.commitAs("codex");
  const r = s.review();
  assert.equal(r.code, 1);
  assert.match(r.out, /Agent fallback/);
});

test("codex-review.sh stays a compatible entry point", () => {
  const s = setup();
  s.commitAs("codex");
  const r = s.repo.run("bash", [join(SCRIPTS, "codex-review.sh"), "T-0099", "1"], {
    PATH: `${join(s.repo.dir, ".fakebin")}:${process.env.PATH}`,
    SKIP_FETCH: "1",
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(s.called(), "claude");
});
