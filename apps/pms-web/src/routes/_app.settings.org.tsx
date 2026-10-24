import { createFileRoute } from "@tanstack/react-router";
import { OrgScreen } from "../features/settings-org/org-screen";

export const Route = createFileRoute("/_app/settings/org")({ component: OrgScreen });
