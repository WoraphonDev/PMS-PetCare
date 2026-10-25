import { createFileRoute } from "@tanstack/react-router";
import { BranchInfoTab } from "../features/settings-branches/branch-info-tab";

export const Route = createFileRoute("/_app/settings/branches/$branchId/")({
  component: function BranchInfoRoute() {
    return <BranchInfoTab branchId={Route.useParams().branchId} />;
  },
});
