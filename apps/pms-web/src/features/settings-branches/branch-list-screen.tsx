import { Button } from "@app/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/form-errors";
import { useOrg } from "../../lib/org-context";
import { can } from "../../lib/permissions";
import { FormMessage } from "../auth/field";
import { CreateBranchDialog } from "./create-branch-dialog";
import { limitText, underLimit, useBranches, useMaySeeBranches, useSubscription } from "./queries";

// foundation#scr-settings-branches — add button only for branch.create and under the plan limit (§7).
export function BranchListScreen() {
  const { membership } = useOrg();
  const maySee = useMaySeeBranches();
  const mayCreate = maySee && membership !== null && can(membership.role, "branch.create");
  const branches = useBranches(maySee);
  const subscription = useSubscription(mayCreate).data;
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("scr-settings-branches.title")}</h1>
        {subscription && underLimit(subscription) && (
          <Button type="button" variant={adding ? "outline" : "default"} aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {t("scr-settings-branches.add")}
          </Button>
        )}
      </div>
      {!maySee && <p>{t("errors.FORBIDDEN")}</p>}
      {subscription && !underLimit(subscription) && <p className="text-sm text-muted-foreground">{limitText(subscription)}</p>}
      {subscription && underLimit(subscription) && adding && <CreateBranchDialog subscription={subscription} />}
      {branches.error && <FormMessage>{errorMessage(branches.error)}</FormMessage>}
      <ul className="flex flex-col divide-y rounded-md border">
        {branches.data?.items.map((b) => (
          <li key={b.id}>
            <Link
              to="/settings/branches/$branchId"
              params={{ branchId: b.id }}
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted"
            >
              <span className="flex flex-col">
                <span className="font-medium">{b.name}</span>
                {b.address && <span className="text-sm text-muted-foreground">{b.address}</span>}
              </span>
              {!b.isActive && <span className="rounded bg-muted px-2 py-0.5 text-xs">{t("scr-settings-branches.inactive")}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
