import { authPasswordForgot } from "@app/api-client";
import { AuthPasswordForgotRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { AuthPage, Field, FormMessage } from "../auth/field";
import { useApi } from "../auth/use-api";

// foundation#scr-auth-forgot (F11): the API always answers 204, so every success shows the same acknowledgement.
export function ForgotScreen() {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthPasswordForgotRequest.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error) });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    try {
      await api.request(authPasswordForgot, { body: parsed.data });
      setAcknowledged(true);
    } catch (error) {
      setErrors(formErrors(error, ["email"]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={t("scr-auth-forgot.title")}>
      <p className="text-sm text-muted-foreground">{t("scr-auth-forgot.note")}</p>
      {acknowledged ? (
        <p role="status">{t("scr-auth-forgot.forgotAck")}</p>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label={t("scr-auth-verify-email.email")}
            type="email"
            autoComplete="email"
            value={email}
            error={errors.fields.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FormMessage>{errors.form}</FormMessage>
          <Button type="submit" disabled={busy}>
            {t("scr-auth-forgot.submit")}
          </Button>
        </form>
      )}
    </AuthPage>
  );
}
