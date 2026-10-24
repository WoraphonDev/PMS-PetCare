import { Button } from "@app/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { t } from "../i18n";
import { meQueryKey, watchSessionExpiry } from "../lib/session";
import { UpdateBanner } from "../pwa/update-banner";
import type { RouterContext } from "../router";

const loggedOutOnly = new Set(["/login", "/signup"]);

function Root() {
  const router = useRouter();
  const { queryClient } = Route.useRouteContext();
  useEffect(
    () =>
      watchSessionExpiry(queryClient, {
        pathname: () => router.state.location.pathname,
        navigate: (to) => void router.navigate({ to }),
      }),
    [queryClient, router],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-dvh overflow-x-hidden">
        <Outlet />
        <UpdateBanner />
      </div>
    </QueryClientProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => {
    // A known session (cached `me`) has nothing to do on the login / signup pages.
    if (loggedOutOnly.has(location.pathname) && context.queryClient.getQueryData(meQueryKey)) throw redirect({ to: "/" });
  },
  component: Root,
  notFoundComponent: () => <p className="p-4">{t("common.notFound")}</p>,
  errorComponent: ({ reset }) => (
    <div className="flex flex-col items-start gap-3 p-4">
      <p>{t("common.error")}</p>
      <Button onClick={reset}>{t("common.retry")}</Button>
    </div>
  ),
});
