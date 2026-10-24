import { ApiError } from "@app/api-client";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../features/shell/app-shell";
import { meQueryOptions } from "../lib/session";

// Pathless layout for every logged-in page: guard (no session → /login, F09 → /change-password), then the shell.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context: { queryClient, api } }) => {
    try {
      let me = await queryClient.ensureQueryData(meQueryOptions(api));
      // A cached `me` from before the forced change would loop back; re-check it with the server.
      if (me.user.mustChangePassword) me = await queryClient.fetchQuery(meQueryOptions(api));
      if (me.user.mustChangePassword) throw redirect({ to: "/change-password" });
      return { me };
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") throw redirect({ to: "/login" });
      throw error;
    }
  },
  component: function AppLayout() {
    return <AppShell me={Route.useRouteContext().me} />;
  },
});
