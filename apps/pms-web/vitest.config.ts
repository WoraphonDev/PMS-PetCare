import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Source and config tests only — they never read dist/. Build-artifact tests use vitest.build.config.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "virtual:pwa-register": fileURLToPath(new URL("./test/stubs/pwa-register.ts", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["test/build/**"],
  },
});
