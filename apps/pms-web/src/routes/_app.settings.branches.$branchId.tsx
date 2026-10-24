import { createFileRoute } from "@tanstack/react-router";
import { BranchLayout } from "../features/settings-branches/branch-layout";

export const Route = createFileRoute("/_app/settings/branches/$branchId")({
  component: function BranchRoute() {
    return <BranchLayout branchId={Route.useParams().branchId} />;
  },
});
