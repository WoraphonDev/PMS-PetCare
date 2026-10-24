import { ApiError, authSignup } from "@app/api-client";
import { AuthSignupRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { AuthPage, Field, FormMessage } from "./field";
import { slugFromShopName } from "./slug";
import { useApi } from "./use-api";

const FIELDS = ["displayName", "email", "password", "orgName", "orgSlug", "branchName"] as const;
type Values = Record<(typeof FIELDS)[number], string>;

// foundation#scr-auth-signup — 201 never logs in and never claims the email was delivered.
export function SignupScreen() {
  const api = useApi();
  const [values, setValues] = useState<Values>({ displayName: "", email: "", password: "", orgName: "", orgSlug: "", branchName: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (key: keyof Values, value: string) =>
    setValues((v) => ({
      ...v,
      [key]: value,
      ...(key === "orgName" && !slugEdited ? { orgSlug: slugFromShopName(value) } : {}),
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthSignupRequest.safeParse(values);
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error, { orgSlug: t("scr-auth-signup.slugHint") }) });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    try {
      await api.request(authSignup, { body: parsed.data });
      setSent(true);
    } catch (error) {
      const conflict = error instanceof ApiError && error.code === "CONFLICT";
      setErrors(conflict ? { fields: {}, form: t("scr-auth-signup.conflict") } : formErrors(error, FIELDS));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <AuthPage title={t("scr-auth-signup.title")}>
        <p role="status">{t("scr-auth-signup.sent")}</p>
        <Link to="/verify-email" className="text-sm text-primary underline">
          {t("scr-auth-signup.resendLink")}
        </Link>
      </AuthPage>
    );

  const field = (key: keyof Values, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field
      label={t(`scr-auth-signup.${key}`)}
      value={values[key]}
      error={errors.fields[key]}
      onChange={(e) => {
        if (key === "orgSlug") setSlugEdited(true);
        set(key, e.target.value);
      }}
      {...extra}
    />
  );

  return (
    <AuthPage title={t("scr-auth-signup.title")}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        {field("displayName", { autoComplete: "name" })}
        {field("email", { type: "email", autoComplete: "email" })}
        {field("password", { type: "password", autoComplete: "new-password" })}
        {field("orgName", { autoComplete: "organization" })}
        {field("orgSlug", { hint: t("scr-auth-signup.slugHint"), autoCapitalize: "none", spellCheck: false })}
        {field("branchName")}
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" disabled={busy}>
          {t("scr-auth-signup.submit")}
        </Button>
      </form>
    </AuthPage>
  );
}
