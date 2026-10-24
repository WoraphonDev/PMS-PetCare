import { ApiError, authTwoFactorVerify } from "@app/api-client";
import { AuthTwoFactorVerifyRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { AuthPage, Field, FormMessage } from "../auth/field";
import { useApi } from "../auth/use-api";

// foundation#scr-auth-2fa (F10). A wrong code and an expired pending session are both UNAUTHENTICATED (one message).
export function TwoFactorScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [toLogin, setToLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthTwoFactorVerifyRequest.safeParse({ code: code.trim(), trustDevice });
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error) });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    setToLogin(false);
    try {
      await api.request(authTwoFactorVerify, { body: parsed.data });
      await navigate({ to: "/" });
    } catch (error) {
      const code = error instanceof ApiError && error.status !== 0 ? error.code : undefined;
      if (code === "UNAUTHENTICATED" || code === "RATE_LIMITED") {
        setErrors({ fields: {}, form: t(code === "RATE_LIMITED" ? "scr-auth-2fa.rateLimited" : "scr-auth-2fa.codeInvalid") });
        setToLogin(true);
      } else setErrors(formErrors(error, ["code"]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={t("scr-auth-2fa.title")}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("scr-auth-2fa.code")}
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="none"
          value={code}
          error={errors.fields.code}
          onChange={(e) => setCode(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
          {t("scr-auth-2fa.trustDevice")}
        </label>
        <FormMessage>{errors.form}</FormMessage>
        {toLogin && (
          <Link to="/login" className="text-sm text-primary underline">
            {t("scr-auth-2fa.toLogin")}
          </Link>
        )}
        <Button type="submit" disabled={busy}>
          {t("scr-auth-2fa.submit")}
        </Button>
      </form>
    </AuthPage>
  );
}
