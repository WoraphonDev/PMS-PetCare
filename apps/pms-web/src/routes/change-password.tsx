import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthPage } from "../features/auth/field";
import { ChangePasswordForm } from "../features/auth-recovery";
import { t } from "../i18n";

// foundation#scr-auth-change-password — forced when `mustChangePassword` (F09).
function ChangePasswordScreen() {
  const navigate = useNavigate();
  return (
    <AuthPage title={t("scr-auth-change-password.title")}>
      <p className="text-sm text-muted-foreground">{t("scr-auth-change-password.forced")}</p>
      <ChangePasswordForm onDone={() => navigate({ to: "/" })} />
    </AuthPage>
  );
}

export const Route = createFileRoute("/change-password")({ component: ChangePasswordScreen });
