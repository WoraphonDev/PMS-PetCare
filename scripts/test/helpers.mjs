import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const SCRIPTS = resolve(import.meta.dirname, "..");

/** Throw-away git repo; `write` + `commit` build history, `run` executes a repo script inside it. */
export function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pms-scripts-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  const write = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  const commit = (msg = "c") => {
    git("add", "-A");
    git("commit", "-q", "-m", msg);
  };
  /** @returns {{ code: number, out: string }} */
  const run = (cmd, args, env = {}) => {
    try {
      const out = execFileSync(cmd, args, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GITHUB_HEAD_REF: "", TASK_ID: "", ...env },
      });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout}${e.stderr}` };
    }
  };
  return { dir, git, write, commit, run };
}
