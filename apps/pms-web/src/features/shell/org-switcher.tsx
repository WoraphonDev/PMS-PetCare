import { Button } from "@app/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useId } from "react";
import { t } from "../../i18n";
import { useOrg } from "../../lib/org-context";
import { logout } from "../../lib/session";
import { AppLink, securityItem } from "./nav";

// foundation#scr-org-switcher — header menu: current shop + role, other shops, branch picker, account, logout.
export function OrgSwitcher() {
  const { me, membership, branch, selectOrg, selectBranch } = useOrg();
  const { api } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const router = useRouter();
  const branchId = useId();
  const others = me.memberships.filter((m) => m.org.id !== membership?.org.id);

  async function onLogout() {
    await logout(api, queryClient);
    await router.navigate({ to: "/login" });
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm hover:bg-muted">
        {membership ? (
          <>
            <span className="font-medium">{membership.org.displayName}</span>{" "}
            <span className="text-muted-foreground">· {t(`shell.role.${membership.role}`)}</span>
          </>
        ) : (
          me.user.name
        )}
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border bg-background p-3 shadow">
        {others.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="text-xs text-muted-foreground">{t("scr-org-switcher.shop")}</h2>
            {others.map((m) => (
              <button
                key={m.org.id}
                type="button"
                className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => selectOrg(m.org.id)}
              >
                {m.org.displayName}
              </button>
            ))}
          </section>
        )}
        {membership && membership.branches.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor={branchId} className="text-xs text-muted-foreground">
              {t("scr-org-switcher.branch")}
            </label>
            <select
              id={branchId}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={branch?.id}
              onChange={(e) => selectBranch(e.target.value)}
            >
              {membership.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <AppLink href={securityItem.path} className="text-sm underline">
          {t(securityItem.label)}
        </AppLink>
        <Button onClick={onLogout}>{t("shell.logout")}</Button>
      </div>
    </details>
  );
}
