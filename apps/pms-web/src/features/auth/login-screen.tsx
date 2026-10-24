import { ApiError, authLogin } from "@app/api-client";
import { AuthLoginRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { AuthPage, Field, FormMessage } from "./field";
import { useApi } from "./use-api";

// foundation#scr-auth-login. A credential call: errors stay on this screen (never the session-expiry redirect).
export function LoginScreen() {
  const api = useApi();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthLoginRequest.safeParse({ identifier, password });
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error) });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    try {
      const result = await api.request(authLogin, { body: parsed.data });
      // /login/2fa and /change-password are T-0045 routes; `href` keeps this card independent of their route types.
      const next = result.twoFactorRequired ? "/login/2fa" : result.mustChangePassword ? "/change-password" : "/";
      await router.navigate({ href: next });
    } catch (error) {
      const code = error instanceof ApiError && error.status !== 0 ? error.code : undefined;
      if (code === "UNAUTHENTICATED") setErrors({ fields: {}, form: t("scr-auth-login.failed") });
      else if (code === "RATE_LIMITED") setErrors({ fields: {}, form: t("scr-auth-login.rateLimited") });
      else setErrors(formErrors(error, ["identifier", "password"]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={t("scr-auth-login.title")}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("scr-auth-login.identifier")}
          autoComplete="username"
          autoCapitalize="none"
          value={identifier}
          error={errors.fields.identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <Field
          label={t("scr-auth-login.password")}
          type="password"
          autoComplete="current-password"
          value={password}
          error={errors.fields.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" disabled={busy}>
          {t("scr-auth-login.submit")}
        </Button>
      </form>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        {/* /forgot-password is built by T-0045 */}
        <a href="/forgot-password" className="text-primary underline">
          {t("scr-auth-login.forgot")}
        </a>
        <Link to="/verify-email" className="text-primary underline">
          {t("scr-auth-login.notVerified")}
        </Link>
      </div>
    </AuthPage>
  );
}
