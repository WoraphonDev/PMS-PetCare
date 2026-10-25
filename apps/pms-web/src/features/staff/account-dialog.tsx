import { ApiError, staffAccountCreate } from "@app/api-client";
import { type Branch, StaffAccountCreateRequest, type StaffMember } from "@app/contracts";
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

const fields = ["displayName", "username", "password", "role", "branchIds"] as const;

/**
 * foundation#contract-staff-account-create (F09) — the temporary password lives only in this form's state: it is not in
 * the success panel, so closing the form drops it for good.
 */
export function AccountDialog({
  actor,
  branches,
  onDone,
}: {
  actor: Role;
  branches: readonly Branch[];
  onDone: (created: StaffMember) => void;
}) {
  const o = useOrgApi();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [assignment, setAssignment] = useState<RoleBranches>({ role: "front_desk", branchIds: [] });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const mutation = useMutation({
    ...o.mutationOptions(({ body }: { orgId: string; body: StaffAccountCreateRequest }) => o.request(staffAccountCreate, { body })),
    onSuccess: (created, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: staffKey(orgId) });
      onDone(created);
    },
    onError: (error, { orgId }) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") void queryClient.invalidateQueries({ queryKey: branchesKey(orgId) });
      setErrors(staffWriteErrors(error, fields));
    },
  });
  // The API stores the trimmed, lowercased username; show what will be saved when it differs from the input.
  const preview = username.trim().toLowerCase();

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = StaffAccountCreateRequest.safeParse({ displayName, username, password, ...roleBranchesBody(assignment) });
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
    <div role="dialog" aria-modal="false" aria-label={t("scr-staff.createAccount")} className="rounded-md border p-4">
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("scr-staff.displayName")}
          value={displayName}
          error={errors.fields.displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Field
          label={t("scr-staff.username")}
          autoComplete="off"
          autoCapitalize="none"
          value={username}
          error={errors.fields.username}
          hint={preview !== username ? preview : undefined}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label={t("scr-staff.tempPassword")}
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          error={errors.fields.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
          {t("scr-staff.showPassword")}
        </label>
        <RoleBranchFields actor={actor} branches={branches} value={assignment} error={errors.fields.branchIds} onChange={setAssignment} />
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" disabled={mutation.isPending}>
          {t("scr-staff.create")}
        </Button>
      </form>
    </div>
  );
}
