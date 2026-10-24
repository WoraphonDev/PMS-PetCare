import { MeResponse } from "@app/contracts";
import { defineEndpoint } from "../client";

// foundation#ep-me.get
export const meGet = defineEndpoint({ method: "GET", path: "/me", response: MeResponse });
