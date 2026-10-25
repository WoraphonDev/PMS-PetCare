import { ApiError, authSignupWithInvitation } from "@app/api-client";
import { AuthSignupWithInvitationRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { Field, FormMessage } from "../auth/field";
import { useApi } from "../auth/use-api";

const failures = {
  CONFLICT: "scr-invite-accept.accountExists",
  INVITATION_INVALID: "scr-invite-accept.invalid",
  ORG_SUSPENDED: "scr-invite-accept.suspended",
} as const;

/** #contract-signup-with-invitation — the email is the invitation's; 201 gives no session (no auto-login). */
export function SignupForm({ token, email, onSignedUp }: { token: string; email: string; onSignedUp: () => void }) {
  const api = useApi();
  const [values, setValues] = useState({ displayName: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthSignupWithInvitationRequest.safeParse({ token, displayName: values.displayName, password: values.password });
    if (!parsed.success) {
      const { token: badToken, ...fields } = issueErrors(parsed.error);
      return setErrors({ fields, form: badToken && t("scr-invite-accept.invalid") });
    }
    if (values.confirm !== values.password) return setErrors({ fields: { confirm: t("scr-auth-change-password.mismatch") } });
    setBusy(true);
    setErrors({ fields: {} });
    try {
      await api.request(authSignupWithInvitation, { body: parsed.data });
      onSignedUp();
    } catch (error) {
      const code = error instanceof ApiError && error.status !== 0 ? error.code : undefined;
      if (code && code in failures) setErrors({ fields: {}, form: t(failures[code as keyof typeof failures]) });
      else setErrors(formErrors(error, ["displayName", "password"]));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label={t("scr-auth-signup.displayName")}
        autoComplete="name"
        value={values.displayName}
        error={errors.fields.displayName}
        onChange={set("displayName")}
      />
      <Field label={t("scr-auth-signup.email")} type="email" readOnly value={email} />
      <Field
        label={t("scr-auth-signup.password")}
        type="password"
        autoComplete="new-password"
        value={values.password}
        error={errors.fields.password}
        onChange={set("password")}
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
        {t("scr-invite-accept.signUp")}
      </Button>
    </form>
  );
}
