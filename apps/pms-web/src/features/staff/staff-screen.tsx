import { ApiError, staffInvitationRevoke } from "@app/api-client";
import type { Branch, Invitation, StaffMember } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/form-errors";
import { formatDate } from "../../lib/format";
import { useOrg, useOrgApi } from "../../lib/org-context";
import { can, canManageMember, canSee, type Role } from "../../lib/permissions";
import { FormMessage } from "../auth/field";
import { useBranches } from "../settings-branches/queries";
import { AccountDialog } from "./account-dialog";
import { InviteDialog } from "./invite-dialog";
import { staffKey, useStaff } from "./queries";
import { StaffRowActions } from "./staff-row-actions";

type Notice = { kind: "status" | "alert"; text: string } | null;
type Open = "invite" | "account" | null;

/** Branch names in branch-list order; [] (owner / manager) → all branches. */
function branchNames(ids: readonly string[], branches: readonly Branch[]) {
  if (ids.length === 0) return t("scr-staff.allBranches");
  return branches
    .filter((b) => ids.includes(b.id))
    .map((b) => b.name)
    .join(", ");
}

// foundation#scr-staff — owner / manager / front_desk (read); invite and create need staff.invite (§7).
export function StaffScreen() {
  const { membership } = useOrg();
  const actor = membership?.role ?? null;
  const maySee = actor !== null && canSee("staff", actor);
  const mayInvite = actor !== null && can(actor, "staff.invite");
  const list = useStaff(maySee);
  const branches = useBranches(maySee).data?.items ?? [];
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<Notice>(null);

  if (!maySee || actor === null) return <p>{t("errors.FORBIDDEN")}</p>;

  const toggle = (next: Exclude<Open, null>) => {
    setNotice(null);
    setOpen(open === next ? null : next);
  };
  const done = (text: string) => {
    setOpen(null);
    setNotice({ kind: "status", text });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("scr-staff.title")}</h1>
      {mayInvite && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={open === "invite" ? "outline" : "default"}
            aria-expanded={open === "invite"}
            onClick={() => toggle("invite")}
          >
            {t("scr-staff.inviteByEmail")}
          </Button>
          <Button
            type="button"
            variant={open === "account" ? "outline" : "default"}
            aria-expanded={open === "account"}
            onClick={() => toggle("account")}
          >
            {t("scr-staff.createAccount")}
          </Button>
        </div>
      )}
      {mayInvite && open === "invite" && (
        <InviteDialog actor={actor} branches={branches} onDone={(created) => done(t("scr-staff.invited", { email: created.email }))} />
      )}
      {mayInvite && open === "account" && (
        <AccountDialog
          actor={actor}
          branches={branches}
          onDone={(created) => done(t("scr-staff.created", { username: created.username ?? "" }))}
        />
      )}
      {notice?.kind === "status" && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {notice.text}
        </p>
      )}
      {notice?.kind === "alert" && <FormMessage>{notice.text}</FormMessage>}
      {list.error && <FormMessage>{errorMessage(list.error)}</FormMessage>}
      {list.data && (
        <>
          <Section title={t("scr-staff.members")}>
            {list.data.members.map((m) => (
              <MemberRow key={m.membershipId} member={m} branches={branches} actions={<StaffRowActions member={m} branches={branches} />} />
            ))}
          </Section>
          <Section title={t("scr-staff.invitations")}>
            {list.data.invitations.map((inv) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                branches={branches}
                mayRevoke={mayInvite && canManageMember(actor, inv.role)}
                onNotice={setNotice}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <ul className="flex flex-col divide-y rounded-md border">{children}</ul>
    </section>
  );
}

/** One member; `actions` is the slot for the T-0047 row menu (edit / remove / reset password). */
export function MemberRow({ member: m, branches, actions }: { member: StaffMember; branches: readonly Branch[]; actions?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="flex flex-wrap items-center gap-2 text-base font-medium">
          {m.displayName}
          {m.isManaged && <span className="rounded bg-muted px-2 py-0.5 text-xs font-normal">{t("scr-staff.managedBadge")}</span>}
        </span>
        {/* Managed accounts have email null (never the internal @managed.invalid address): show the username. */}
        <span className="break-all text-muted-foreground">{m.email ?? m.username}</span>
        <span>{t(`shell.role.${m.role as Role}`)}</span>
        <span>{branchNames(m.branchIds, branches)}</span>
        <span className="text-muted-foreground">{t(m.twoFactorEnabled ? "scr-staff.twoFactorOn" : "scr-staff.twoFactorOff")}</span>
      </div>
      {actions}
    </li>
  );
}

function InvitationRow({
  invitation: inv,
  branches,
  mayRevoke,
  onNotice,
}: {
  invitation: Invitation;
  branches: readonly Branch[];
  mayRevoke: boolean;
  onNotice: (notice: Notice) => void;
}) {
  const o = useOrgApi();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    ...o.mutationOptions(({ id }: { orgId: string; id: string }) => o.request(staffInvitationRevoke, { params: { invitationId: id } })),
    onSuccess: (_, { orgId }) => void queryClient.invalidateQueries({ queryKey: staffKey(orgId) }),
    onError: (error, { orgId }) => {
      // Already used, revoked or expired: the list is stale.
      if (error instanceof ApiError && error.code === "NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
        onNotice({ kind: "alert", text: t("scr-staff.invitationGone") });
      } else {
        onNotice({ kind: "alert", text: errorMessage(error) });
      }
    },
  });

  function confirmRevoke() {
    onNotice(null);
    if (window.confirm(t("scr-staff.confirmRevoke", { email: inv.email }))) revoke.mutate({ orgId: o.orgId, id: inv.id });
  }

  return (
    <li className="flex items-start justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="break-all text-base font-medium">{inv.email}</span>
        <span>{t(`shell.role.${inv.role as Role}`)}</span>
        <span>{branchNames(inv.branchIds, branches)}</span>
        <span className="text-muted-foreground">{t("scr-staff.expires", { date: formatDate(inv.expiresAt) })}</span>
      </div>
      {mayRevoke && (
        <Button type="button" variant="outline" disabled={revoke.isPending} onClick={confirmRevoke}>
          {t("scr-staff.revoke")}
        </Button>
      )}
    </li>
  );
}
