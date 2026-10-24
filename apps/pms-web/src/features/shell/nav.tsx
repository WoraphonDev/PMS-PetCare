import { useRouter } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { t } from "../../i18n";
import { canSee, type Role, type Screen } from "../../lib/permissions";

// foundation §7 "ผู้ใช้" column. Items whose page comes with a later card show the not-found page until then.
const roleItems = [
  { screen: "org", path: "/settings/org", label: "shell.nav.org" },
  { screen: "branches", path: "/settings/branches", label: "shell.nav.branches" },
  { screen: "staff", path: "/settings/staff", label: "shell.nav.staff" },
  { screen: "audit", path: "/settings/audit", label: "shell.nav.audit" },
  { screen: "subscription", path: "/settings/subscription", label: "shell.nav.subscription" },
] as const satisfies ReadonlyArray<{ screen: Screen; path: string; label: string }>;

export const securityItem = { path: "/account/security", label: "shell.nav.security" } as const;
export const platformItem = { path: "/platform/orgs", label: "shell.nav.platform" } as const;

export type NavItem = { path: string; label: (typeof roleItems)[number]["label"] | "shell.nav.security" | "shell.nav.platform" };

export function navItems(role: Role | null, isPlatformAdmin: boolean): NavItem[] {
  return [...(role ? roleItems.filter((item) => canSee(item.screen, role)) : []), securityItem, ...(isPlatformAdmin ? [platformItem] : [])];
}

/** In-app link by href: target routes are added by later cards, so they are not in the route types yet. */
export function AppLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  const router = useRouter();
  return (
    <a
      href={href}
      {...props}
      onClick={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        void router.navigate({ href });
      }}
    />
  );
}

export function Nav({ items }: { items: NavItem[] }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b px-4 py-2 text-sm">
      {items.map((item) => (
        <AppLink key={item.path} href={item.path} className="rounded-md px-2 py-1 hover:bg-muted">
          {t(item.label)}
        </AppLink>
      ))}
    </nav>
  );
}
