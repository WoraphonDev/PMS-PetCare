import { defineConfig } from "vitest/config";

// `pnpm test:build`: builds the app fresh into a temp dir and checks the emitted service worker and manifest.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/build/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
