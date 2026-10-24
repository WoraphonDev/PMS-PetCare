import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

const GH = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.includes('--json headRefOid')) console.log(process.env.MOCK_HEAD);
else if (args.includes('--json labels')) console.log(process.env.MOCK_LABEL);
else if (process.argv[2] === 'api') console.log(JSON.stringify(process.env.MOCK_APPROVED ? [[{ id: 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- pms-agent-approved-sha:' + process.env.MOCK_APPROVED + ' -->' }]] : [[]]));
else if (args.startsWith('pr comment')) console.log('anchor recorded');
else process.exit(2);
`;
function fixture() {
  const r = tempRepo();
  r.write(
    Object.fromEntries(
      ["check-approval-proof.sh", "approved-head.mjs", "same-pr-diff.sh"].map((f) => [
        `scripts/${f}`,
        readFileSync(join(SCRIPTS, f), "utf8"),
      ]),
    ),
  );
  r.write({ "base.txt": "base\n" });
  r.commit("base");
  r.git("remote", "add", "origin", r.dir);
  r.git("checkout", "-q", "-b", "t-0099-x");
  r.write({ "pr.txt": "reviewed\n" });
  r.commit("reviewed A");
  const approved = r.git("rev-parse", "HEAD");
  r.write({ ".git/stub/gh": GH });
  chmodSync(join(r.dir, ".git/stub/gh"), 0o755);
  const run = (env = {}) => {
    const head = r.git("rev-parse", "HEAD");
    r.git("update-ref", "refs/pull/1/head", head);
    return r.run("bash", ["scripts/check-approval-proof.sh"], {
      PATH: `${join(r.dir, ".git/stub")}:${process.env.PATH}`,
      REPO: "test/repo",
      PR: "1",
      AFTER: head,
      RUNNER_TEMP: join(r.dir, ".git"),
      EVENT_ACTION: "synchronize",
      EVENT_LABEL: "",
      MOCK_HEAD: head,
      MOCK_LABEL: "agent-approved",
      MOCK_APPROVED: approved,
      ...env,
    });
  };
  const sync = () => {
    r.git("checkout", "-q", "main");
    r.write({ "main.txt": "main update\n" });
    r.commit("main update");
    r.git("checkout", "-q", "t-0099-x");
    r.git("merge", "-q", "--no-edit", "main");
  };
  return { ...r, run, sync, approved };
}
test("explicit label approves exact event head; missing label/stale event cannot pass", () => {
  const r = fixture();
  assert.equal(r.run({ EVENT_ACTION: "labeled", EVENT_LABEL: "agent-approved", MOCK_APPROVED: "" }).code, 0);
  assert.notEqual(r.run({ MOCK_LABEL: "" }).code, 0);
  assert.notEqual(r.run({ MOCK_HEAD: "0".repeat(40) }).code, 0);
  assert.notEqual(r.run({ MOCK_APPROVED: "" }).code, 0);
});
test("already approved head and clean main-only sync pass", () => {
  const r = fixture();
  assert.equal(r.run().code, 0);
  r.sync();
  const res = r.run();
  assert.equal(res.code, 0, res.out);
});
test("skipped reset cannot approve B or its subsequent clean sync C", () => {
  const r = fixture();
  r.write({ "pr.txt": "unreviewed B\n" });
  r.commit("B");
  assert.notEqual(r.run().code, 0);
  r.sync();
  // A's trusted anchor remains in the comments even if B's reset never executed.
  const res = r.run();
  assert.notEqual(res.code, 0, res.out);
  assert.match(res.out, /new review needed/);
});
