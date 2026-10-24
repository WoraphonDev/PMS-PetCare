import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./src/pwa/options";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss(), VitePWA(pwaOptions)],
  // Local dev is same-origin: run the API with APP_ORIGIN=http://localhost:5173.
  server: { proxy: { "/api": "http://localhost:3000" } },
});
