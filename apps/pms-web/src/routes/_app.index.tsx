import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { Home } from "../features/shell/home";
import { useOrg } from "../lib/org-context";
import { restorePendingInvite, takeJoinedOrg } from "../lib/pending-invite";

export const Route = createFileRoute("/_app/")({
  // scr-invite-accept login detour: login lands here; a saved invitation goes back to /invite (token in memory only).
  beforeLoad: ({ preload }) => {
    if (!preload && restorePendingInvite()) throw redirect({ to: "/invite" });
  },
  component: Index,
});

function Index() {
  const { selectOrg } = useOrg();
  useEffect(() => {
    const orgId = takeJoinedOrg();
    if (orgId) selectOrg(orgId);
  }, [selectOrg]);
  return <Home />;
}
