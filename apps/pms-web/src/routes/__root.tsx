import { Button } from "@app/ui";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { t } from "../i18n";
import { UpdateBanner } from "../pwa/update-banner";
import type { RouterContext } from "../router";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="min-h-dvh overflow-x-hidden">
      <Outlet />
      <UpdateBanner />
    </div>
  ),
  notFoundComponent: () => <p className="p-4">{t("common.notFound")}</p>,
  errorComponent: ({ reset }) => (
    <div className="flex flex-col items-start gap-3 p-4">
      <p>{t("common.error")}</p>
      <Button onClick={reset}>{t("common.retry")}</Button>
    </div>
  ),
});
