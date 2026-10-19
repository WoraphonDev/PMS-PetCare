import type { RequestContext } from "../../../common/context";

// docs/spec/features/foundation.md#ep-system.health — liveness only, never touches the database.
// TODO(Q-0011): move the response schema to packages/contracts/src/system/system.health.ts
export interface SystemHealthResponse {
  status: "ok";
  version: string;
}

export async function systemHealth(ctx: RequestContext): Promise<SystemHealthResponse> {
  return { status: "ok", version: ctx.buildSha };
}
