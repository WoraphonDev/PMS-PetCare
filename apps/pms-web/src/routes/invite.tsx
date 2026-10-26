import { createFileRoute } from "@tanstack/react-router";
import { InviteScreen } from "../features/invite/invite-screen";

// Public: no `_app` guard — the screen reads the session itself (T-0047).
export const Route = createFileRoute("/invite")({ component: InviteScreen });
