import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkRegistry, REGISTRIES } from "../check-registries.mjs";
import { SCRIPTS } from "./helpers.mjs";

test("barrel: sorted one-line exports pass", () => {
  assert.deepEqual(checkRegistry("barrel", 'export { a } from "./a/x";\nexport * from "./b";\n'), []);
});

test("barrel: unsorted or multi-line exports fail", () => {
  assert.match(checkRegistry("barrel", 'export * from "./b";\nexport * from "./a";\n')[0], /"\.\/a" must come before "\.\/b"/);
  assert.equal(checkRegistry("barrel", 'export {\n  a,\n} from "./a";\n').length, 3);
});

const mods = (body) => `  return {\n    imports: [\n${body}\n    ],\n  };\n`;

test("modules: one per line, sorted, trailing commas, spread last", () => {
  assert.deepEqual(checkRegistry("modules", mods("      AModule,\n      BModule,\n      ...extra,")), []);
  assert.match(checkRegistry("modules", mods("      BModule,\n      AModule,"))[0], /"AModule" must come before "BModule"/);
  assert.match(checkRegistry("modules", mods("      AModule,\n      BModule"))[0], /trailing comma/);
  assert.match(checkRegistry("modules", mods("      ...extra,\n      AModule,"))[0], /spread/);
  assert.match(checkRegistry("modules", "    imports: [AModule, BModule],\n")[0], /one module per line/);
});

test("the repository's registries are sorted", () => {
  for (const { file, kind } of REGISTRIES) assert.deepEqual(checkRegistry(kind, readFileSync(join(SCRIPTS, "..", file), "utf8")), [], file);
});
