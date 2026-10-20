import type { MeResponse } from "@app/contracts";
import type { Db } from "@app/db";
import { membershipsOf, type UserRow } from "../identity.repository";

// docs/spec/features/foundation.md#ep-me.get
export async function meGet(ctx: { user: UserRow }, deps: { platformDb: Db }): Promise<MeResponse> {
  const u = ctx.user;
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.isManaged ? null : u.email,
      username: u.username ?? null,
      isPlatformAdmin: u.isPlatformAdmin,
      mustChangePassword: u.mustChangePassword,
      twoFactorEnabled: u.twoFactorEnabled,
    },
    memberships: await membershipsOf(deps.platformDb, u.id),
  };
}
