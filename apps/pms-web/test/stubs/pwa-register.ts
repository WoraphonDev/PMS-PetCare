import { vi } from "vitest";

// Stand-in for vite-plugin-pwa's `virtual:pwa-register` (aliased in vitest.config.ts); tests read its calls.
export const registerSW = vi.fn((_options?: { onNeedRefresh?: () => void }) => vi.fn(async (_reload?: boolean) => {}));
