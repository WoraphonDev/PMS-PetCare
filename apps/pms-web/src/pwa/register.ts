import { registerSW } from "virtual:pwa-register";

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

let needRefresh = false;
let updateSW: UpdateSW | undefined;
const listeners = new Set<() => void>();

/** Registers the service worker once at start-up. `registerType: "prompt"`: a new version waits for the user. */
export function registerPwa(): void {
  updateSW = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      for (const listener of listeners) listener();
    },
  });
}

export const pwaUpdate = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isWaiting: () => needRefresh,
  /** Activates the waiting version and reloads the page. */
  apply: () => updateSW?.(true),
};
