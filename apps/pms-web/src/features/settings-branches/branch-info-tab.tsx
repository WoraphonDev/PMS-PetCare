import { ApiError, branchUpdate } from "@app/api-client";
import { type Branch, type BranchListResponse, BranchUpdateRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { useOrg, useOrgApi } from "../../lib/org-context";
import { can } from "../../lib/permissions";
import { FormMessage } from "../auth/field";
import { BranchFields, branchValues, coordsError, emptyBranch, numberOrNull, textOrNull } from "./branch-fields";
import { branchesKey, useBranches, useMaySeeBranches } from "./queries";

// foundation#scr-settings-branch ข้อมูล tab — `timezone` and `promptpayId` are read-only here (#ep-branch.update).
export function BranchInfoTab({ branchId }: { branchId: string }) {
  const branches = useBranches(useMaySeeBranches());
  const branch = branches.data?.items.find((b) => b.id === branchId);
  // The layout shows "not found"; a background refetch must not re-mount the form and drop unsaved edits.
  return branch ? <InfoForm key={branch.id} branch={branch} /> : null;
}

/** Only changed fields; the coordinates go as a pair whenever either changed (#contract-branch). */
function changes(branch: Branch, values: ReturnType<typeof branchValues>, isActive: boolean) {
  const initial = branchValues(branch);
  const body: Record<string, unknown> = {};
  if (values.name !== initial.name) body.name = values.name;
  if (values.address !== initial.address) body.address = textOrNull(values.address);
  if (values.phone !== initial.phone) body.phone = textOrNull(values.phone);
  if (values.latitude !== initial.latitude || values.longitude !== initial.longitude) {
    body.latitude = numberOrNull(values.latitude);
    body.longitude = numberOrNull(values.longitude);
  }
  if (isActive !== branch.isActive) body.isActive = isActive;
  return body;
}

function InfoForm({ branch: latest }: { branch: Branch }) {
  const { membership } = useOrg();
  const editable = membership !== null && can(membership.role, "branch.update");
  const o = useOrgApi();
  const queryClient = useQueryClient();
  const activeId = useId();
  // `branch` is the server copy the form started from; newer server data replaces it only while the form is
  // untouched (or on save), so a refetch never drops unsaved edits.
  const [branch, setBranch] = useState(latest);
  const [values, setValues] = useState(() => branchValues(latest));
  const [isActive, setIsActive] = useState(latest.isActive);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const body = changes(branch, values, isActive);
  const reset = (b: Branch) => {
    setBranch(b);
    setValues(branchValues(b));
    setIsActive(b.isActive);
  };
  if (latest !== branch && Object.keys(body).length === 0) reset(latest);
  const mutation = useMutation({
    // The shop goes with the variables: callbacks run with the latest render, which may be another shop by then.
    ...o.mutationOptions(({ body }: { orgId: string; body: BranchUpdateRequest }) =>
      o.request(branchUpdate, { params: { branchId: branch.id }, body }),
    ),
    onSuccess: (updated, { orgId }) => {
      reset(updated);
      queryClient.setQueryData<BranchListResponse>(
        branchesKey(orgId),
        (list) => list && { items: list.items.map((b) => (b.id === updated.id ? updated : b)) },
      );
    },
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : null;
      if (code === "CONFLICT") setErrors({ fields: { name: t("scr-settings-branches.nameTaken") } });
      else if (code === "NOT_FOUND") setErrors({ fields: {}, form: t("scr-settings-branch.notFound") });
      else setErrors(formErrors(error, Object.keys(emptyBranch)));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const pair = coordsError(values);
    const parsed = BranchUpdateRequest.safeParse(body);
    if (!parsed.success || Object.keys(pair).length > 0) {
      setErrors({ fields: { ...(parsed.success ? {} : issueErrors(parsed.error)), ...pair } });
      return;
    }
    setErrors({ fields: {} });
    mutation.mutate({ orgId: o.orgId, body: parsed.data });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <BranchFields values={values} errors={errors.fields} onChange={setValues} disabled={!editable} />
      <div className="flex items-center gap-2">
        <input id={activeId} type="checkbox" checked={isActive} disabled={!editable} onChange={(e) => setIsActive(e.target.checked)} />
        <label htmlFor={activeId} className="text-sm">
          {t("scr-settings-branch.isActive")}
        </label>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("scr-settings-branch.timezone")}</dt>
        <dd>{branch.timezone}</dd>
        <dt className="text-muted-foreground">{t("scr-settings-branch.tabPayment")}</dt>
        <dd>{branch.promptpayId ?? "–"}</dd>
      </dl>
      <FormMessage>{errors.form}</FormMessage>
      {editable && (
        <Button type="submit" disabled={mutation.isPending || Object.keys(body).length === 0}>
          {t("scr-settings-branch.save")}
        </Button>
      )}
    </form>
  );
}
