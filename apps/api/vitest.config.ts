import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Nest relies on decorator metadata, which esbuild does not emit — compile with SWC instead.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
});
