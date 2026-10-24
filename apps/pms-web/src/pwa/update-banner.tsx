import { Button } from "@app/ui";
import { useRef, useState, useSyncExternalStore } from "react";
import { t } from "../i18n";
import { pwaUpdate } from "./register";

/** T-0022-02 A: never reloads by itself; the user presses อัปเดต (which reloads — unsaved form data can be lost). */
export function UpdateBanner() {
  const waiting = useSyncExternalStore(pwaUpdate.subscribe, pwaUpdate.isWaiting);
  const [pressed, setPressed] = useState(false);
  const applied = useRef(false); // a second press before the re-render must not call updateSW again
  if (!waiting) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <span>{t("common.updateAvailable")}</span>
      <Button
        size="sm"
        disabled={pressed}
        onClick={() => {
          if (applied.current) return;
          applied.current = true;
          setPressed(true);
          void pwaUpdate.apply();
        }}
      >
        {t("common.update")}
      </Button>
    </div>
  );
}
