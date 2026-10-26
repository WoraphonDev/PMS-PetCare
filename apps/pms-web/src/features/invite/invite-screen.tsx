import { ApiError, invitationAccept, invitationPreview, meGet } from "@app/api-client";
import type { InvitationPreviewResponse, MeResponse } from "@app/contracts";
import { Button } from "@app/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/form-errors";
import { formatDate } from "../../lib/format";
import { clearHeldInvite, heldInvite, rememberJoinedOrg, savePendingInvite } from "../../lib/pending-invite";
import type { Role } from "../../lib/permissions";
import { meQueryKey } from "../../lib/session";
import { AuthPage, FormMessage } from "../auth/field";
import { useApi } from "../auth/use-api";
import { SignupForm } from "./signup-form";

type Stage =
  | { kind: "loading" | "invalid" | "suspended" | "signedUp" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; preview: InvitationPreviewResponse };

const tokenFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, "")).get("token");
// token = `<orgId>.<random>` (#rule-invitation-token).
const orgOf = (token: string) => token.slice(0, token.indexOf("."));

function previewFailure(error: unknown): Stage {
  const code = error instanceof ApiError && error.status !== 0 ? error.code : undefined;
  if (code === "INVITATION_INVALID" || code === "VALIDATION_FAILED") return { kind: "invalid" };
  if (code === "ORG_SUSPENDED") return { kind: "suspended" };
  return { kind: "failed", message: errorMessage(error) };
}

/**
 * foundation#scr-invite-accept (public). The token comes from the fragment (or the login detour's memory), is cleared
 * from history before any request, and is only ever sent in JSON bodies. `me` is read without `sessionRequired`:
 * UNAUTHENTICATED just means "not logged in" here.
 */
export function InviteScreen() {
  const api = useApi();
  const [token] = useState(() => tokenFromHash(window.location.hash) || heldInvite());
  const [cleared, setCleared] = useState(false);
  // Accept answered UNAUTHENTICATED: the session ended while on this page.
  const [signedOut, setSignedOut] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: token ? "loading" : "invalid" });
  const started = useRef(false);
  const me = useQuery({ queryKey: ["me", "optional"], queryFn: () => api.request(meGet), enabled: cleared, gcTime: 0 });

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per page load; the token never changes
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.location.hash || window.location.search) window.history.replaceState(null, "", "/invite");
    clearHeldInvite();
    if (!token) return;
    setCleared(true);
    api.request(invitationPreview, { body: { token } }).then(
      (preview) => setStage({ kind: "ready", preview }),
      (error) => setStage(previewFailure(error)),
    );
  }, []);

  return (
    <AuthPage title={t("scr-invite-accept.title")}>
      {stage.kind === "invalid" && <p role="alert">{t("scr-invite-accept.invalid")}</p>}
      {stage.kind === "suspended" && <p role="alert">{t("scr-invite-accept.suspended")}</p>}
      {stage.kind === "failed" && <p role="alert">{stage.message}</p>}
      {stage.kind === "signedUp" && (
        <>
          <p role="status">{t("scr-invite-accept.signedUp")}</p>
          <Button asChild>
            <Link to="/login">{t("scr-auth-login.title")}</Link>
          </Button>
        </>
      )}
      {stage.kind === "ready" && token && (
        <>
          <div className="flex flex-col gap-1">
            <p>
              {t("scr-invite-accept.summary", { shop: stage.preview.orgDisplayName, role: t(`shell.role.${stage.preview.role as Role}`) })}
            </p>
            <p>{stage.preview.branchNames.length > 0 ? stage.preview.branchNames.join(", ") : t("scr-staff.allBranches")}</p>
            <p className="break-all text-sm text-muted-foreground">
              {t("scr-invite-accept.forEmail", { email: stage.preview.email, date: formatDate(stage.preview.expiresAt) })}
            </p>
          </div>
          {me.data && !signedOut ? (
            <Accept token={token} me={me.data} preview={stage.preview} onSignedOut={() => setSignedOut(true)} />
          ) : (
            (me.isError || signedOut) && <Choices token={token} preview={stage.preview} onSignedUp={() => setStage({ kind: "signedUp" })} />
          )}
        </>
      )}
    </AuthPage>
  );
}

function Accept({
  token,
  me,
  preview,
  onSignedOut,
}: {
  token: string;
  me: MeResponse;
  preview: InvitationPreviewResponse;
  onSignedOut: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [alreadyMember, setAlreadyMember] = useState(false);

  const goToShop = async (orgId: string) => {
    rememberJoinedOrg(orgId);
    await navigate({ to: "/" });
  };

  async function accept() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.request(invitationAccept, { body: { token } });
      // The `_app` guard loads the new `me` (with this shop) before `/` makes it current.
      queryClient.removeQueries({ queryKey: meQueryKey, exact: true });
      await goToShop(result.orgId);
    } catch (error) {
      const code = error instanceof ApiError && error.status !== 0 ? error.code : undefined;
      if (code === "UNAUTHENTICATED") onSignedOut();
      else if (code === "ALREADY_MEMBER") setAlreadyMember(true);
      else if (code === "INVITATION_INVALID") setMessage(t("scr-invite-accept.acceptInvalid"));
      else if (code === "ORG_SUSPENDED") setMessage(t("scr-invite-accept.suspended"));
      else setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (alreadyMember)
    return (
      <>
        <p role="status">{t("scr-invite-accept.alreadyMember")}</p>
        <Button type="button" onClick={() => void goToShop(orgOf(token))}>
          {preview.orgDisplayName}
        </Button>
      </>
    );
  return (
    <>
      <p className="break-all">{t("scr-invite-accept.acceptAs", { account: me.user.email ?? me.user.username ?? "" })}</p>
      {me.user.email?.toLowerCase() !== preview.email.toLowerCase() && (
        <p role="alert" className="text-sm text-destructive">
          {t("scr-invite-accept.wrongAccount", { email: preview.email })}
        </p>
      )}
      <FormMessage>{message}</FormMessage>
      <Button type="button" disabled={busy} onClick={() => void accept()}>
        {t("scr-invite-accept.accept")}
      </Button>
    </>
  );
}

function Choices({ token, preview, onSignedUp }: { token: string; preview: InvitationPreviewResponse; onSignedUp: () => void }) {
  const navigate = useNavigate();
  const [signingUp, setSigningUp] = useState(false);
  const login = () => {
    savePendingInvite(token);
    void navigate({ to: "/login" });
  };
  return (
    <>
      <Button type="button" onClick={login}>
        {t("scr-invite-accept.haveAccount")}
      </Button>
      <Button type="button" variant="outline" aria-expanded={signingUp} onClick={() => setSigningUp(!signingUp)}>
        {t("scr-invite-accept.noAccount")}
      </Button>
      {signingUp && <SignupForm token={token} email={preview.email} onSignedUp={onSignedUp} />}
    </>
  );
}
