import { ApiError, staffInvite } from "@app/api-client";
import { type Branch, type Invitation, StaffInviteRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, issueErrors } from "../../lib/form-errors";
import { useOrgApi } from "../../lib/org-context";
import type { Role } from "../../lib/permissions";
import { Field, FormMessage } from "../auth/field";
import { branchesKey } from "../settings-branches/queries";
import { staffKey, staffWriteErrors } from "./queries";
import { missingBranch, type RoleBranches, RoleBranchFields, roleBranchesBody } from "./role-branch-fields";

const fields = ["email", "role", "branchIds"] as const;

/**
 * foundation#contract-staff-invite — re-inviting an email with a pending invitation is allowed (the API replaces it).
 * Success only says the invitation exists: the email goes out after commit and may still fail.
 */
export function InviteDialog({
  actor,
  branches,
  onDone,
}: {
  actor: Role;
  branches: readonly Branch[];
  onDone: (created: Invitation) => void;
}) {
  const o = useOrgApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [assignment, setAssignment] = useState<RoleBranches>({ role: "front_desk", branchIds: [] });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const mutation = useMutation({
    ...o.mutationOptions(({ body }: { orgId: string; body: StaffInviteRequest }) => o.request(staffInvite, { body })),
    onSuccess: (created, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
      onDone(created);
    },
    onError: (error, { orgId }) => {
      // A picked branch may be gone: reload the picker's list.
      if (error instanceof ApiError && error.code === "NOT_FOUND") void queryClient.invalidateQueries({ queryKey: branchesKey(orgId) });
      setErrors(staffWriteErrors(error, fields));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = StaffInviteRequest.safeParse({ email, ...roleBranchesBody(assignment) });
    const found = {
      ...(parsed.success ? {} : issueErrors(parsed.error)),
      ...(missingBranch(assignment) ? { branchIds: t("errors.BRANCH_REQUIRED") } : {}),
    };
    if (!parsed.success || Object.keys(found).length > 0) {
      setErrors({ fields: found });
      return;
    }
    setErrors({ fields: {} });
    mutation.mutate({ orgId: o.orgId, body: parsed.data });
  }

  return (
    <div role="dialog" aria-modal="false" aria-label={t("scr-staff.inviteByEmail")} className="rounded-md border p-4">
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("scr-staff.email")}
          type="email"
          autoComplete="off"
          value={email}
          error={errors.fields.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <RoleBranchFields actor={actor} branches={branches} value={assignment} error={errors.fields.branchIds} onChange={setAssignment} />
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" disabled={mutation.isPending}>
          {t("scr-staff.invite")}
        </Button>
      </form>
    </div>
  );
}
