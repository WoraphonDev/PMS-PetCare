import type { VitePWAOptions } from "vite-plugin-pwa";

// T-0022: precache only the built app shell; never cache API responses (tenant data and sessions) and never answer
// /api navigations with index.html. Offline API calls therefore fail and surface as ApiError status 0.
export const pwaOptions = {
  registerType: "prompt",
  injectRegister: false, // src/pwa/register.ts registers through virtual:pwa-register
  includeManifestIcons: false, // the icons are already matched by workbox.globPatterns
  manifest: {
    name: "PMS PetCare",
    short_name: "PetCare",
    lang: "th",
    display: "standalone",
    start_url: "/",
    theme_color: "#0e7c86",
    background_color: "#ffffff",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    mode: "production", // same service worker whatever NODE_ENV the build runs under (e.g. test:build)
    globPatterns: ["**/*.{js,css,html,webmanifest,png}"],
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api(\/|$)/],
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
  },
} satisfies Partial<VitePWAOptions>;
