import { createFileRoute } from "@tanstack/react-router";
import { StaffScreen } from "../features/staff/staff-screen";
import { useOrg } from "../lib/org-context";

// Re-mounted per shop: open forms, typed passwords and notices never carry over to another shop.
function StaffPage() {
  return <StaffScreen key={useOrg().membership?.org.id} />;
}

export const Route = createFileRoute("/_app/settings/staff")({ component: StaffPage });
