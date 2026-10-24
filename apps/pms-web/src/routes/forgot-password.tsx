import { createFileRoute } from "@tanstack/react-router";
import { ForgotScreen } from "../features/auth-recovery/forgot-screen";

export const Route = createFileRoute("/forgot-password")({ component: ForgotScreen });
