import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

// main and a PR branch diverge; `before` is the approved head. Each case then pushes something and asks the script
// whether the PR's own diff is still the same.
function approvedPr() {
  const r = tempRepo();
  r.write({ "a.txt": "a1\na2\na3\na4\na5\na6\na7\na8\na9\n", "b.txt": "b\n" });
  r.commit("base");
  r.git("checkout", "-q", "-b", "t-0099-x");
  r.write({ "pr.txt": "pr change\n", "a.txt": "a1\nA2-pr\na3\na4\na5\na6\na7\na8\na9\n" });
  r.commit("pr");
  const before = r.git("rev-parse", "HEAD");
  const check = (after) => r.run("bash", [join(SCRIPTS, "same-pr-diff.sh"), before, after, "main"]);
  return { ...r, before, check };
}

const onMain = (r, files) => {
  r.git("checkout", "-q", "main");
  r.write(files);
  r.commit("main moves");
  r.git("checkout", "-q", "t-0099-x");
};

test("merging main that touched other files keeps the approval", () => {
  const r = approvedPr();
  onMain(r, { "b.txt": "b changed on main\n", "c.txt": "new on main\n" });
  r.git("merge", "-q", "--no-edit", "main");
  const res = r.check(r.git("rev-parse", "HEAD"));
  assert.equal(res.code, 0, res.out);
});

test("merging main that changed far-away lines of the same file keeps the approval", () => {
  const r = approvedPr();
  onMain(r, { "a.txt": "a1\na2\na3\na4\na5\na6\na7\na8\nA9-main\n" });
  r.git("merge", "-q", "--no-edit", "main");
  const res = r.check(r.git("rev-parse", "HEAD"));
  assert.equal(res.code, 0, res.out);
});

test("a merge of main plus an extra edit needs a new review", () => {
  const r = approvedPr();
  onMain(r, { "b.txt": "b changed on main\n" });
  r.git("merge", "-q", "--no-commit", "main");
  r.write({ "pr.txt": "pr change, edited during the merge\n" });
  r.commit("merge main + sneak edit");
  assert.equal(r.check(r.git("rev-parse", "HEAD")).code, 1);
});

test("a new commit on the branch needs a new review", () => {
  const r = approvedPr();
  r.write({ "pr.txt": "pr change v2\n" });
  r.commit("more work");
  assert.equal(r.check(r.git("rev-parse", "HEAD")).code, 1);
});

test("a conflict resolved differently from the approved change needs a new review", () => {
  const r = approvedPr();
  onMain(r, { "a.txt": "a1\nA2-main\na3\na4\na5\na6\na7\na8\na9\n" });
  r.run("git", ["merge", "--no-edit", "main"]);
  r.write({ "a.txt": "a1\nA2-main\na3\na4\na5\na6\na7\na8\na9\n" });
  r.commit("resolve conflict taking main");
  assert.equal(r.check(r.git("rev-parse", "HEAD")).code, 1);
});

test("rewritten history (rebase / force-push) needs a new review", () => {
  const r = approvedPr();
  onMain(r, { "b.txt": "b changed on main\n" });
  r.git("rebase", "-q", "main");
  const res = r.check(r.git("rev-parse", "HEAD"));
  assert.equal(res.code, 1);
  assert.match(res.out, /not one two-parent sync merge/);
});

test("even whitespace-only edits hidden in a sync merge require review", () => {
  const r = approvedPr();
  onMain(r, { "b.txt": "main update\n" });
  r.git("merge", "-q", "--no-commit", "main");
  r.write({ "pr.txt": "  pr change\n" });
  r.commit("sync with whitespace edit");
  assert.equal(r.check(r.git("rev-parse", "HEAD")).code, 1);
});

test("merging a feature branch, not main, does not preserve approval", () => {
  const r = approvedPr();
  r.git("checkout", "-q", "-b", "other", "main");
  r.write({ "evil.txt": "unreviewed\n" });
  r.commit("other feature");
  r.git("checkout", "-q", "t-0099-x");
  r.git("merge", "-q", "--no-edit", "other");
  const res = r.check(r.git("rev-parse", "HEAD"));
  assert.equal(res.code, 1);
  assert.match(res.out, /not trusted main/);
});

test("new work followed by a clean main merge still requires review", () => {
  const r = approvedPr();
  r.write({ "pr.txt": "changed after review\n" });
  r.commit("unreviewed work");
  onMain(r, { "b.txt": "main update\n" });
  r.git("merge", "-q", "--no-edit", "main");
  assert.equal(r.check(r.git("rev-parse", "HEAD")).code, 1);
});

test("missing or malformed evidence fails closed", () => {
  const r = approvedPr();
  assert.notEqual(r.run("bash", [join(SCRIPTS, "same-pr-diff.sh"), "bad", r.before, "main"]).code, 0);
  assert.notEqual(r.run("bash", [join(SCRIPTS, "same-pr-diff.sh"), "0".repeat(40), "1".repeat(40), "main"]).code, 0);
});
