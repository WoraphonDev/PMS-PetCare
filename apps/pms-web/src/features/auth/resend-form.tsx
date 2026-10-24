import { authEmailVerificationResend } from "@app/api-client";
import { AuthEmailVerificationResendRequest } from "@app/contracts";
import { Button } from "@app/ui";
import { type FormEvent, useState } from "react";
import { t } from "../../i18n";
import { type FormErrors, formErrors, issueErrors } from "../../lib/form-errors";
import { Field, FormMessage } from "./field";
import { useApi } from "./use-api";

// foundation#rule-email-verification-http: every 204 gets the same acknowledgement (no account or delivery hint).
export function ResendForm() {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = AuthEmailVerificationResendRequest.safeParse({ email });
    if (!parsed.success) {
      setErrors({ fields: issueErrors(parsed.error) });
      return;
    }
    setBusy(true);
    setErrors({ fields: {} });
    try {
      await api.request(authEmailVerificationResend, { body: parsed.data });
      setAcknowledged(true);
    } catch (error) {
      setErrors(formErrors(error, ["email"]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{t("scr-auth-verify-email.resendTitle")}</h2>
      {acknowledged ? (
        <p role="status">{t("scr-auth-verify-email.resendAck")}</p>
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
            {t("scr-auth-verify-email.resendSubmit")}
          </Button>
        </form>
      )}
    </section>
  );
}
