import { ApiError, authEmailVerify } from "@app/api-client";
import { Button } from "@app/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { AuthPage } from "./field";
import { ResendForm } from "./resend-form";
import { useApi } from "./use-api";

type State = "pending" | "success" | "invalid" | "network" | "noToken";

// null = no `token=` in the fragment; "" = present but empty — still posted, so the API answers (invalid).
const tokenFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, "")).get("token");

// foundation#scr-auth-verify-email: the token arrives in the fragment, is cleared from history before anything else,
// kept in memory only and sent as JSON. It is never logged or put in a URL.
export function VerifyEmailScreen() {
  const api = useApi();
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [state, setState] = useState<State>(token !== null ? "pending" : "noToken");
  const started = useRef(false);

  async function verify(value: string) {
    setState("pending");
    try {
      await api.request(authEmailVerify, { body: { token: value } });
      setState("success");
    } catch (error) {
      const invalid = error instanceof ApiError && error.code === "VALIDATION_FAILED";
      setState(invalid ? "invalid" : "network");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page load; the token never changes
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.location.hash) window.history.replaceState(null, "", "/verify-email");
    if (token !== null) void verify(token);
  }, []);

  return (
    <AuthPage>
      {state === "pending" && <p role="status">{t("scr-auth-verify-email.pending")}</p>}
      {state === "success" && (
        <>
          <p role="status">{t("scr-auth-verify-email.success")}</p>
          <Button asChild>
            <Link to="/login">{t("scr-auth-verify-email.toLogin")}</Link>
          </Button>
        </>
      )}
      {state === "invalid" && <p role="alert">{t("scr-auth-verify-email.invalid")}</p>}
      {state === "network" && (
        <>
          <p role="alert">{t("scr-auth-verify-email.network")}</p>
          <Button variant="outline" onClick={() => token !== null && void verify(token)}>
            {t("scr-auth-verify-email.retry")}
          </Button>
        </>
      )}
      {(state === "invalid" || state === "network" || state === "noToken") && <ResendForm />}
    </AuthPage>
  );
}
