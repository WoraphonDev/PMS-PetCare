import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { SCRIPTS, tempRepo } from "./helpers.mjs";

const ROOT = join(SCRIPTS, "..");
const BIOME = join(ROOT, "node_modules/.bin/biome");
function check(css) {
  const r = tempRepo();
  r.write({ "tokens.css": css });
  return r.run(BIOME, ["check", "--config-path", ROOT, "--formatter-enabled=false", "--assist-enabled=false", "tokens.css"]);
}
test("root Biome parser supports Tailwind v4 source and theme directives", () => {
  const result = check('@source "./";\n@theme { --color-primary: oklch(0.55 0.15 200); }\n');
  assert.equal(result.code, 0, result.out);
});
test("CSS is still parsed, not excluded or silently ignored", () => {
  const result = check("@theme { --color-primary: oklch(0.55 0.15 200);\n");
  assert.notEqual(result.code, 0);
  assert.match(result.out, /parse/);
});
