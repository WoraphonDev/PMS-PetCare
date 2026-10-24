import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.match(checkRegistry("modules", mods("      ZModule, AModule,"))[0], /one module per line: ZModule, AModule,/);
  assert.match(checkRegistry("modules", mods("      AModule,\n      ...extra, ZModule,")).join(), /one module per line/);
});

const blk = (body) => `import x from "./x";\n// registry:start\n${body}\n// registry:end\nexport const y = 1;\n`;

test("block: sorted one-line entries between markers pass; code outside is ignored", () => {
  assert.deepEqual(checkRegistry("block", blk('import { a } from "./a";\nimport { b } from "./b";')), []);
  assert.deepEqual(checkRegistry("block", `${blk("  a,\n  b,")}${blk('export * from "./c";')}`), []);
});

test("block: unsorted, multi-line, blank or comment entries fail", () => {
  assert.match(checkRegistry("block", blk("  b,\n  a,"))[0], /"a," must come before "b,"/);
  assert.deepEqual(checkRegistry("block", blk('  common,\n  "scr-auth-login": scrAuthLogin,')), [], "quotes are ignored when sorting");
  assert.match(checkRegistry("block", blk('  "scr-auth-login": scrAuthLogin,\n  common,'))[0], /"common," must come before/);
  assert.match(checkRegistry("block", blk("  a: {\n  },"))[0], /one complete entry per line/);
  assert.match(checkRegistry("block", blk("  a\n  b,"))[0], /one complete entry per line/);
  assert.match(checkRegistry("block", blk("  a,\n\n  b,"))[0], /no blank or comment/);
  assert.match(checkRegistry("block", blk("  a,\n  // b\n  c,"))[0], /no blank or comment/);
});

test("block: missing or broken markers fail", () => {
  assert.match(checkRegistry("block", 'export * from "./a";\n')[0], /no registry block/);
  assert.match(checkRegistry("block", "// registry:start\n  a,\n").join(), /never closed/);
  assert.match(checkRegistry("block", "  a,\n// registry:end\n").join(), /without/);
});

test("optional registries are files created by later cards", () => {
  for (const { file, optional } of REGISTRIES.filter((r) => r.optional)) assert.ok(optional && file.endsWith(".ts"), file);
});

test("the repository's registries are sorted", () => {
  for (const { file, kind, optional } of REGISTRIES) {
    const path = join(SCRIPTS, "..", file);
    if (optional && !existsSync(path)) continue;
    assert.deepEqual(checkRegistry(kind, readFileSync(path, "utf8")), [], file);
  }
});
