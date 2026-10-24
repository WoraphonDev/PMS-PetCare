import { ApiError, authPasswordChange } from "@app/api-client";
import { AuthPasswordChangeRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { Field, FormMessage } from "../auth/field";
import { useApi } from "../auth/use-api";

/**
 * foundation#ep-auth.password_change — shared by /change-password (forced, F09) and account security (T-0048).
 * A credential call: a wrong current password (UNAUTHENTICATED) is shown here, never a redirect.
 */
export function ChangePasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const api = useApi();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthPasswordChangeRequest.safeParse({ currentPassword: values.currentPassword, newPassword: values.newPassword });
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error) });
      return;
    }
    if (values.confirm !== values.newPassword) {
      setErrors({ fields: { confirm: t("scr-auth-change-password.mismatch") } });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    try {
      await api.request(authPasswordChange, { body: parsed.data });
      await onDone();
    } catch (error) {
      const wrongCurrent = error instanceof ApiError && error.code === "UNAUTHENTICATED";
      setErrors(
        wrongCurrent
          ? { fields: { currentPassword: t("scr-auth-change-password.wrongCurrent") } }
          : formErrors(error, ["currentPassword", "newPassword"]),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label={t("scr-auth-change-password.current")}
        type="password"
        autoComplete="current-password"
        value={values.currentPassword}
        error={errors.fields.currentPassword}
        onChange={set("currentPassword")}
      />
      <Field
        label={t("scr-auth-change-password.new")}
        type="password"
        autoComplete="new-password"
        value={values.newPassword}
        error={errors.fields.newPassword}
        onChange={set("newPassword")}
      />
      <Field
        label={t("scr-auth-change-password.confirm")}
        type="password"
        autoComplete="new-password"
        value={values.confirm}
        error={errors.fields.confirm}
        onChange={set("confirm")}
      />
      <FormMessage>{errors.form}</FormMessage>
      <Button type="submit" disabled={busy}>
        {t("scr-auth-change-password.submit")}
      </Button>
    </form>
  );
}
