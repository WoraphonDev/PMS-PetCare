import { ApiError, authPasswordReset } from "@app/api-client";
import { AuthPasswordResetRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { AuthPage, Field, FormMessage } from "../auth/field";
import { useApi } from "../auth/use-api";

// foundation#scr-auth-reset. The emailed link carries the token in the query string (T-0008); it is removed from the
// address bar and history on load and kept in memory only — never logged.
export function ResetScreen() {
  const api = useApi();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [tokenInvalid, setTokenInvalid] = useState(!token);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const cleared = useRef(false);

  useEffect(() => {
    if (cleared.current) return;
    cleared.current = true;
    if (window.location.search || window.location.hash) window.history.replaceState(null, "", "/reset-password");
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthPasswordResetRequest.safeParse({ token, password: values.password });
    if (!parsed.success) {
      const fields = issueErrors(parsed.error);
      // The token is not a form field: a link token the contract rejects means the link is unusable.
      if ("token" in fields) setTokenInvalid(true);
      else setErrors({ fields });
      return;
    }
    if (values.confirm !== values.password) {
      setErrors({ fields: { confirm: t("scr-auth-change-password.mismatch") } });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    try {
      await api.request(authPasswordReset, { body: parsed.data });
      setDone(true);
    } catch (error) {
      const fields = error instanceof ApiError && error.code === "VALIDATION_FAILED" ? error.details?.fields : undefined;
      if (typeof fields === "object" && fields !== null && "token" in fields) setTokenInvalid(true);
      else setErrors(formErrors(error, ["password"]));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  return (
    <AuthPage title={t("scr-auth-reset.title")}>
      {done ? (
        <>
          <p role="status">{t("scr-auth-reset.success")}</p>
          <Button asChild>
            <Link to="/login">{t("scr-auth-login.title")}</Link>
          </Button>
        </>
      ) : tokenInvalid ? (
        <>
          <p role="alert">{t("scr-auth-reset.tokenInvalid")}</p>
          <Link to="/forgot-password" className="text-sm text-primary underline">
            {t("scr-auth-reset.requestNew")}
          </Link>
        </>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label={t("scr-auth-change-password.new")}
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
            {t("scr-auth-reset.submit")}
          </Button>
        </form>
      )}
    </AuthPage>
  );
}
