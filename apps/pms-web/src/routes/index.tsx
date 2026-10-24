import { createFileRoute } from "@tanstack/react-router";
import { t } from "../i18n";

// Placeholder home — replaced by T-0023 / T-0024; not a spec screen.
export const Route = createFileRoute("/")({
  component: () => (
    <main className="p-4">
      <h1 className="text-xl font-semibold">{t("common.appName")}</h1>
    </main>
  ),
});
