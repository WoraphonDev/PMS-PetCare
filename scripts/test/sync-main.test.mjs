import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

// Stub pnpm: `install` rewrites the lockfile, `verify` fails when VERIFY_FAIL=1, `generate` writes nothing.
const PNPM =
  '#!/bin/sh\n[ "$1" = install ] && echo "lock: regenerated" > pnpm-lock.yaml\n[ "$1" = verify ] && [ "$VERIFY_FAIL" = 1 ] && exit 1\nexit 0\n';

// main and the branch diverge from a common base; returns a repo on the branch with the stub pnpm on PATH.
function diverged(mainChange, branchChange) {
  const r = tempRepo();
  r.write({ "pnpm-lock.yaml": "lock: base\n", "a.txt": "base\n", "packages/db/migrations/0000_init.sql": "create table a();\n" });
  r.commit("base");
  r.git("remote", "add", "origin", r.dir);
  r.git("checkout", "-q", "-b", "t-0099-x");
  branchChange(r);
  r.commit("branch");
  r.git("checkout", "-q", "main");
  mainChange(r);
  r.commit("main");
  r.git("checkout", "-q", "t-0099-x");
  const bin = join(r.dir, ".git", "stub-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pnpm"), PNPM);
  chmodSync(join(bin, "pnpm"), 0o755);
  const sync = (env = {}) => r.run("bash", [join(SCRIPTS, "sync-main.sh")], { PATH: `${bin}:${process.env.PATH}`, ...env });
  return { ...r, sync };
}
const files = (f) => (r) => r.write(f);

test("lockfile conflict: takes main's lockfile, regenerates with pnpm install, commits", () => {
  const r = diverged(files({ "pnpm-lock.yaml": "lock: main\n" }), files({ "pnpm-lock.yaml": "lock: branch\n", "b.txt": "mine\n" }));
  const res = r.sync();
  assert.equal(res.code, 0, res.out);
  assert.equal(readFileSync(join(r.dir, "pnpm-lock.yaml"), "utf8"), "lock: regenerated\n");
  assert.equal(r.git("status", "--porcelain"), "");
  assert.equal(r.git("config", "rerere.enabled"), "true");
});

test("conflict in a normal file: stops, lists it, leaves the merge for a human/agent", () => {
  const r = diverged(files({ "a.txt": "main\n" }), files({ "a.txt": "branch\n" }));
  const res = r.sync();
  assert.equal(res.code, 1);
  assert.match(res.out, /manual resolution[\s\S]*a\.txt/);
});

test("binary and modify/delete conflicts (no markers) also stop instead of picking a side", () => {
  const bin = (s) => Buffer.from([0, 1, 2, ...Buffer.from(s)]);
  const r = diverged(
    (m) => {
      m.write({ "img.bin": bin("main") });
      m.git("rm", "-q", "a.txt");
    },
    files({ "img.bin": bin("branch"), "a.txt": "branch edit\n" }),
  );
  const res = r.sync();
  assert.equal(res.code, 1);
  assert.match(res.out, /img\.bin/);
  assert.match(res.out, /a\.txt/);
});

test("already up to date still runs pnpm verify and reports its failure", () => {
  const r = diverged(files({ "c.txt": "main\n" }), files({ "b.txt": "mine\n" }));
  assert.equal(r.sync().code, 0);
  const again = r.sync({ VERIFY_FAIL: "1" });
  assert.match(again.out, /already up to date/);
  assert.equal(again.code, 1);
});

test("migration conflict where regeneration yields nothing: stops, and a re-run is blocked until resolved", () => {
  const journal = (tag) => `{"entries":[{"idx":1,"tag":"${tag}"}]}\n`;
  const r = diverged(
    files({
      "packages/db/migrations/0001_main.sql": "alter table a add x int;\n",
      "packages/db/migrations/meta/_journal.json": journal("0001_main"),
    }),
    files({ "packages/db/migrations/0001_mine.sql": "-- custom rls\n", "packages/db/migrations/meta/_journal.json": journal("0001_mine") }),
  );
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /missing or differs/);
  assert.ok(existsSync(join(r.dir, ".git", "sync-main-backup", "0001_mine.sql")));
  assert.ok(!existsSync(join(r.dir, "packages/db/migrations/0001_mine.sql")));
  const again = r.sync();
  assert.equal(again.code, 1);
  assert.match(again.out, /previous sync left work to finish/);
});
