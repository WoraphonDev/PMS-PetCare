import { createFileRoute } from "@tanstack/react-router";
import { VerifyEmailScreen } from "../features/auth/verify-email-screen";

export const Route = createFileRoute("/verify-email")({ component: VerifyEmailScreen });
