import { defineConfig } from "tsdown";

// Production bundle for the Docker image (T-0031): workspace packages (@app/*) are TypeScript sources, so they are
// bundled; third-party dependencies stay external and come from `pnpm deploy --prod`.
export default defineConfig({
  entry: ["src/main.ts", "src/worker.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node24",
  noExternal: [/^@app\//],
  sourcemap: false,
  dts: false,
  clean: true,
  // package.json has "type": "module", so plain .js is ESM
  outExtensions: () => ({ js: ".js" }),
});
