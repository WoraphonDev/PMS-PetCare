import { createFileRoute } from "@tanstack/react-router";
import { BranchListScreen } from "../features/settings-branches/branch-list-screen";

export const Route = createFileRoute("/_app/settings/branches/")({ component: BranchListScreen });
