import { t } from "../../i18n";
import { useOrg } from "../../lib/org-context";

// `/` — no dashboard screen exists in the spec: greeting, shop name and role only (data from `me.get`).
export function Home() {
  const { me, membership } = useOrg();
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold">{membership?.org.displayName}</h1>
      <p>{t("shell.welcome", { name: me.user.name })}</p>
      {membership && <p className="text-sm text-muted-foreground">{t(`shell.role.${membership.role}`)}</p>}
    </div>
  );
}
