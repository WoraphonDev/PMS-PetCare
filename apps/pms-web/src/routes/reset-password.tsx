import { createFileRoute } from "@tanstack/react-router";
import { ResetScreen } from "../features/auth-recovery/reset-screen";

export const Route = createFileRoute("/reset-password")({ component: ResetScreen });
