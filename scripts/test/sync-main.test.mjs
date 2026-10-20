import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

// main and the branch both changed `file`; returns a repo on the branch with a stub pnpm on PATH.
function diverged(mainFiles, branchFiles) {
  const r = tempRepo();
  r.write({ "pnpm-lock.yaml": "lock: base\n", "a.txt": "base\n" });
  r.commit("base");
  r.git("remote", "add", "origin", r.dir);
  r.git("checkout", "-q", "-b", "t-0099-x");
  r.write(branchFiles);
  r.commit("branch");
  r.git("checkout", "-q", "main");
  r.write(mainFiles);
  r.commit("main");
  r.git("checkout", "-q", "t-0099-x");
  const bin = join(r.dir, ".git", "stub-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pnpm"), '#!/bin/sh\n[ "$1" = install ] && echo "lock: regenerated" > pnpm-lock.yaml\nexit 0\n');
  chmodSync(join(bin, "pnpm"), 0o755);
  return { ...r, sync: () => r.run("bash", [join(SCRIPTS, "sync-main.sh")], { PATH: `${bin}:${process.env.PATH}` }) };
}

test("lockfile conflict: takes main's lockfile, regenerates with pnpm install, commits", () => {
  const r = diverged({ "pnpm-lock.yaml": "lock: main\n" }, { "pnpm-lock.yaml": "lock: branch\n", "b.txt": "mine\n" });
  const res = r.sync();
  assert.equal(res.code, 0, res.out);
  assert.equal(readFileSync(join(r.dir, "pnpm-lock.yaml"), "utf8"), "lock: regenerated\n");
  assert.equal(r.git("status", "--porcelain"), "");
  assert.equal(r.git("config", "rerere.enabled"), "true");
});

test("conflict in a normal file: stops, lists it, leaves the merge for a human/agent", () => {
  const r = diverged({ "a.txt": "main\n" }, { "a.txt": "branch\n" });
  const res = r.sync();
  assert.equal(res.code, 1);
  assert.match(res.out, /manual resolution[\s\S]*a\.txt/);
});

test("already up to date: nothing to do", () => {
  const r = diverged({ "c.txt": "main\n" }, { "b.txt": "mine\n" });
  assert.equal(r.sync().code, 0);
  assert.equal(r.sync().out.trim(), "already up to date with origin/main");
});
