import type { MeResponse } from "@app/contracts";
import { Outlet, useRouteContext } from "@tanstack/react-router";
import { t } from "../../i18n";
import { OrgProvider, useOrg } from "../../lib/org-context";
import { useMe } from "../../lib/session";
import { AppLink, Nav, navItems, platformItem } from "./nav";
import { OrgSwitcher } from "./org-switcher";

/** Layout of every page under `_app`; `me` was loaded by the route guard. */
export function AppShell({ me: initial }: { me: MeResponse }) {
  const { api } = useRouteContext({ from: "__root__" });
  const me = useMe(api, initial);
  return (
    // Re-key per user so a different login never inherits the previous context.
    <OrgProvider key={me.user.id} me={me}>
      <ShellLayout />
    </OrgProvider>
  );
}

function ShellLayout() {
  const { me, membership } = useOrg();
  return (
    <div className="flex min-h-dvh flex-col">
      {membership?.org.status === "suspended" && (
        <p role="alert" className="bg-destructive px-4 py-2 text-sm text-destructive-foreground">
          {t("shell.suspended")}
        </p>
      )}
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="font-semibold">{t("common.appName")}</span>
        <OrgSwitcher />
      </header>
      <Nav items={navItems(membership?.role ?? null, me.user.isPlatformAdmin)} />
      <main className="flex-1 p-4">
        {membership ? (
          <Outlet />
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p>{t("shell.noOrg")}</p>
            {me.user.isPlatformAdmin && (
              <AppLink href={platformItem.path} className="underline">
                {t(platformItem.label)}
              </AppLink>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
