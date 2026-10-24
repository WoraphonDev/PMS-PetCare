import { createFileRoute } from "@tanstack/react-router";
import { TwoFactorScreen } from "../features/auth-recovery/two-factor-screen";

export const Route = createFileRoute("/login_/2fa")({ component: TwoFactorScreen });
