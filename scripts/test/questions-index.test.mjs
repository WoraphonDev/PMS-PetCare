import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { parseQuestion } from "../questions-index.mjs";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

const GOOD = "# T-0007-01 · title\n- Status: open\n- Raised by: claude · T-0007 · 2026-10-20\n- Question: q\n";

test("parses a well-formed question", () => {
  assert.deepEqual(parseQuestion("T-0007-01.md", GOOD), { id: "T-0007-01", title: "title", status: "open", card: "T-0007", errors: [] });
});

test("rejects wrong file name, mismatched heading and bad status", () => {
  assert.equal(parseQuestion("T-0007.md", GOOD.replace("T-0007-01", "T-0007")).errors.length, 1);
  assert.match(parseQuestion("T-0007-02.md", GOOD).errors[0], /does not match file name/);
  assert.match(parseQuestion("T-0007-01.md", GOOD.replace("open", "pending")).errors[0], /Status/);
});

test("--check fails on a bad fixture and --open lists only open questions", () => {
  const r = tempRepo();
  r.write({ "q/T-0007-01.md": GOOD, "q/Q-0001.md": "# Q-0001 · old\n- Status: answered\n- Raised by: x · ADR-0003 · 2026-10-19\n" });
  const script = join(SCRIPTS, "questions-index.mjs");
  assert.equal(r.run("node", [script, "--check", "q"]).code, 0);
  const open = r.run("node", [script, "--open", "q"]).out;
  assert.match(open, /T-0007-01/);
  assert.doesNotMatch(open, /Q-0001/);
  r.write({ "q/T-0008-01.md": "no heading\n" });
  assert.equal(r.run("node", [script, "--check", "q"]).code, 1);
});

test("the repository's own questions pass --check", () => {
  const r = tempRepo();
  const res = r.run("node", [join(SCRIPTS, "questions-index.mjs"), "--check", join(SCRIPTS, "../docs/questions")]);
  assert.equal(res.code, 0, res.out);
});
