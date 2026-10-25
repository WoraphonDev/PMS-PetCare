import { ApiError, staffPasswordReset } from "@app/api-client";
import { type StaffMember, StaffPasswordResetRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { useOrgApi } from "../../lib/org-context";
import { Field, FormMessage } from "../auth/field";

/** #contract-staff-password-reset (F09) — the new temporary password lives only in this form until it is sent. */
export function ResetDialog({ member }: { member: StaffMember }) {
  const o = useOrgApi();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const mutation = useMutation({
    ...o.mutationOptions(({ body }: { orgId: string; body: StaffPasswordResetRequest }) =>
      o.request(staffPasswordReset, { params: { membershipId: member.membershipId }, body }),
    ),
    onSuccess: () => setPassword(""),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "MANAGED_ACCOUNT_ONLY")
        setErrors({ fields: {}, form: t("scr-staff-manage.managedOnly") });
      else setErrors(formErrors(error, ["newPassword"]));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = StaffPasswordResetRequest.safeParse({ newPassword: password });
    if (!parsed.success) return setErrors({ fields: issueErrors(parsed.error) });
    setErrors({ fields: {} });
    mutation.mutate({ orgId: o.orgId, body: parsed.data });
  }

  return (
    <div role="dialog" aria-modal="false" aria-label={t("scr-staff-manage.resetPassword")} className="rounded-md border p-4">
      {mutation.isSuccess ? (
        <p role="status" className="text-sm">
          {t("scr-staff-manage.resetDone")}
        </p>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label={t("scr-staff-manage.newTempPassword")}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            error={errors.fields.newPassword}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
            {t("scr-staff.showPassword")}
          </label>
          <FormMessage>{errors.form}</FormMessage>
          <Button type="submit" disabled={mutation.isPending}>
            {t("scr-staff-manage.resetPassword")}
          </Button>
        </form>
      )}
    </div>
  );
}
