import type { Branch, StaffMember } from "@app/contracts";
import { Button } from "@app/ui";
import { useState } from "react";
import { t } from "../../i18n";
import { useOrg } from "../../lib/org-context";
import { canManageMember, type Role } from "../../lib/permissions";
import { FormMessage } from "../auth/field";
import { EditDialog } from "../staff-manage/edit-dialog";
import { ResetDialog } from "../staff-manage/reset-dialog";
import { useRemoveMember } from "../staff-manage/use-remove";

type Open = "edit" | "reset" | null;

/**
 * Fills MemberRow's `actions` slot (T-0047). Shown only when ¹ lets the viewer manage this member; reset only for
 * managed accounts (F09). A fragment: the open panel is its own item in the row, under the details.
 */
export function StaffRowActions({ member, branches }: { member: StaffMember; branches: readonly Branch[] }) {
  const actor = useOrg().membership?.role ?? null;
  const [open, setOpen] = useState<Open>(null);
  const removal = useRemoveMember(member);
  if (actor === null || !canManageMember(actor, member.role as Role)) return null;

  const toggle = (next: Exclude<Open, null>) => setOpen(open === next ? null : next);
  const toggleButton = (next: Exclude<Open, null>, label: string) => (
    <Button type="button" variant="outline" aria-expanded={open === next} onClick={() => toggle(next)}>
      {label}
    </Button>
  );
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1">
        {toggleButton("edit", t("scr-staff-manage.edit"))}
        <Button type="button" variant="outline" disabled={removal.pending} onClick={removal.remove}>
          {t("scr-staff-manage.remove")}
        </Button>
        {member.isManaged && toggleButton("reset", t("scr-staff-manage.resetPassword"))}
      </div>
      {(open !== null || removal.error) && (
        <div className="basis-full">
          <FormMessage>{removal.error}</FormMessage>
          {open === "edit" && <EditDialog member={member} branches={branches} onDone={() => setOpen(null)} />}
          {open === "reset" && <ResetDialog member={member} />}
        </div>
      )}
    </>
  );
}
