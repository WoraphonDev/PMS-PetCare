import { Outlet, useRouterState } from "@tanstack/react-router";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/form-errors";
import { useOrg } from "../../lib/org-context";
import { can } from "../../lib/permissions";
import { FormMessage } from "../auth/field";
import { AppLink } from "../shell/nav";
import { useBranches, useMaySeeBranches } from "./queries";

// foundation#scr-settings-branch — tab frame. Hours / closures / payment pages come with T-0046 (not found until then).
export function BranchLayout({ branchId }: { branchId: string }) {
  const { membership } = useOrg();
  const maySee = useMaySeeBranches();
  const branches = useBranches(maySee);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!maySee) return <p>{t("errors.FORBIDDEN")}</p>;
  if (branches.error) return <FormMessage>{errorMessage(branches.error)}</FormMessage>;
  if (!branches.data) return null;
  // Not in the list: another shop's branch, or not assigned to this user (F02).
  const branch = branches.data.items.find((b) => b.id === branchId);
  if (!branch) return <p>{t("scr-settings-branch.notFound")}</p>;

  const base = `/settings/branches/${branch.id}`;
  const tabs = [
    { href: base, label: t("scr-settings-branch.tabInfo") },
    { href: `${base}/hours`, label: t("scr-settings-branch.tabHours") },
    { href: `${base}/closures`, label: t("scr-settings-branch.tabClosures") },
    ...(membership && can(membership.role, "branch.payment_settings.update")
      ? [{ href: `${base}/payment`, label: t("scr-settings-branch.tabPayment") }]
      : []),
  ];
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-xl font-semibold">{branch.name}</h1>
      <nav className="flex flex-wrap gap-1 border-b text-sm">
        {tabs.map((tab) => (
          <AppLink
            key={tab.href}
            href={tab.href}
            aria-current={pathname === tab.href ? "page" : undefined}
            className="px-3 py-2 aria-[current=page]:border-b-2 aria-[current=page]:border-primary aria-[current=page]:font-medium"
          >
            {tab.label}
          </AppLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
