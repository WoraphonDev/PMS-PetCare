import { ApiError, staffUpdate } from "@app/api-client";
import { type Branch, type StaffMember, StaffUpdateRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { useOrg, useOrgApi } from "../../lib/org-context";
import type { Role } from "../../lib/permissions";
import { meQueryKey } from "../../lib/session";
import { Field, FormMessage } from "../auth/field";
import { branchesKey } from "../settings-branches/queries";
import { staffKey } from "../staff/queries";
import { isBranchRole, missingBranch, type RoleBranches, RoleBranchFields } from "../staff/role-branch-fields";

const fields = ["displayName", "role", "branchIds"] as const;
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * #contract-staff-update — only what differs from `member`. An org-wide role never sends `branchIds` (the API clears
 * them); leaving owner/manager for a branch role always sends them.
 */
function changes(member: StaffMember, displayName: string, next: RoleBranches) {
  const body: { displayName?: string; role?: Role; branchIds?: string[] } = {};
  if (displayName.trim() !== member.displayName) body.displayName = displayName;
  if (next.role !== member.role) body.role = next.role;
  const fromOrgWide = !isBranchRole(member.role as Role);
  if (isBranchRole(next.role) && (fromOrgWide || !sameIds(next.branchIds, member.branchIds))) body.branchIds = next.branchIds;
  return body;
}

export function EditDialog({ member, branches, onDone }: { member: StaffMember; branches: readonly Branch[]; onDone: () => void }) {
  const o = useOrgApi();
  const { me, membership } = useOrg();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(member.displayName);
  const [assignment, setAssignment] = useState<RoleBranches>({ role: member.role as Role, branchIds: [...member.branchIds] });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const mutation = useMutation({
    ...o.mutationOptions(({ body }: { orgId: string; body: StaffUpdateRequest }) =>
      o.request(staffUpdate, { params: { membershipId: member.membershipId }, body }),
    ),
    onSuccess: (_, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
      // A changed own role changes what the shell may show.
      if (member.userId === me.user.id) void queryClient.invalidateQueries({ queryKey: meQueryKey });
      onDone();
    },
    onError: (error, { orgId }) => {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === "LAST_OWNER") setErrors({ fields: {}, form: t("scr-staff-manage.lastOwner") });
      else if (code === "BRANCH_REQUIRED") setErrors({ fields: { branchIds: t("errors.BRANCH_REQUIRED") } });
      else setErrors(formErrors(error, fields));
      // Removed meanwhile, or a branch that is gone: both lists may be stale.
      if (code === "NOT_FOUND") {
        void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
        void queryClient.invalidateQueries({ queryKey: branchesKey(orgId) });
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = changes(member, displayName, assignment);
    if (Object.keys(body).length === 0) return onDone();
    const parsed = StaffUpdateRequest.safeParse(body);
    const found = {
      ...(parsed.success ? {} : issueErrors(parsed.error)),
      ...(missingBranch(assignment) ? { branchIds: t("errors.BRANCH_REQUIRED") } : {}),
    };
    if (!parsed.success || Object.keys(found).length > 0) return setErrors({ fields: found });
    setErrors({ fields: {} });
    mutation.mutate({ orgId: o.orgId, body: parsed.data });
  }

  return (
    <div role="dialog" aria-modal="false" aria-label={t("scr-staff-manage.edit")} className="rounded-md border p-4">
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("scr-staff.displayName")}
          value={displayName}
          error={errors.fields.displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <RoleBranchFields
          actor={membership?.role ?? "front_desk"}
          branches={branches}
          value={assignment}
          error={errors.fields.branchIds}
          onChange={setAssignment}
        />
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" disabled={mutation.isPending}>
          {t("scr-staff-manage.save")}
        </Button>
      </form>
    </div>
  );
}
