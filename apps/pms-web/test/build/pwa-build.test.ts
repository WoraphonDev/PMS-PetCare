import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Builds the app fresh into a new temp directory, so every assertion reads output of this run — never an old dist/.
const appDir = fileURLToPath(new URL("../..", import.meta.url));
let outDir = "";
const read = (file: string) => readFileSync(join(outDir, file), "utf8");

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "pms-web-build-"));
  await build({
    root: appDir,
    configFile: join(appDir, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
});

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("built PWA", () => {
  it("emits sw.js and a Thai manifest linked from index.html", () => {
    expect(existsSync(join(outDir, "sw.js"))).toBe(true);
    const manifest = JSON.parse(read("manifest.webmanifest")) as { lang: string; display: string; start_url: string };
    expect(manifest).toMatchObject({ lang: "th", display: "standalone", start_url: "/" });
    expect(read("index.html")).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  });

  it("precaches only files this build produced, none under /api", () => {
    const urls = [...read("sw.js").matchAll(/\{\s*"?url"?\s*:\s*"([^"]+)"\s*,\s*"?revision"?\s*:/g)].map((m) => m[1] as string);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, url).not.toMatch(/^\/?api(\/|$)/);
      expect(existsSync(join(outDir, url)), url).toBe(true);
    }
    expect(urls).toEqual(expect.arrayContaining(["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"]));
  });

  it("registers exactly one route: the navigation fallback, which excludes /api", () => {
    const sw = read("sw.js");
    expect(sw.match(/registerRoute\(/g)).toHaveLength(1);
    expect(sw).toMatch(
      /registerRoute\(\s*new \w+\.NavigationRoute\(\s*\w+\.createHandlerBoundToURL\("\/index\.html"\)\s*,\s*\{\s*denylist:\s*\[\s*\/\^\\\/api\(\\\/\|\$\)\/\s*\]\s*\}\s*\)\s*\)/,
    );
    expect(sw).not.toMatch(/runtime|NetworkFirst|CacheFirst|StaleWhileRevalidate/);
  });

  it("index.html loads the entry script that registers sw.js (prompt mode, no auto-injected registerSW.js)", () => {
    const html = read("index.html");
    const entry = html.match(/<script type="module" crossorigin src="\/([^"]+)"><\/script>/)?.[1];
    expect(entry).toBeDefined();
    const js = read(entry as string);
    expect(js).toContain("serviceWorker");
    expect(js).toContain("/sw.js");
    expect(html).not.toContain("registerSW.js");
    expect(readdirSync(outDir)).not.toContain("registerSW.js");
  });
});
