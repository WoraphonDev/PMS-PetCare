import { defineConfig } from "vitest/config";

// The client runs in the browser; tests stub `fetch`, so Node's built-in Response/Headers are enough.
export default defineConfig({
  test: { environment: "node" },
});
