import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS } from "./helpers.mjs";

// macOS ships bash 3.2, which fails to parse some constructs newer bash accepts (e.g. an apostrophe inside a
// heredoc nested in $(…)). Agents run these scripts locally, so every one must parse with the oldest bash we meet.
const BASH = ["/bin/bash", "bash"].find((b) => {
  try {
    execFileSync(b, ["-c", "true"]);
    return true;
  } catch {
    return false;
  }
});

for (const file of readdirSync(SCRIPTS).filter((f) => f.endsWith(".sh"))) {
  test(`${file} parses with ${BASH}`, () => {
    assert.doesNotThrow(() => execFileSync(BASH, ["-n", join(SCRIPTS, file)], { stdio: "pipe" }));
  });
}
