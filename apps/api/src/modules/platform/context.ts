import type { Db } from "@app/db";

/** Per-request context of a platform admin call (PlatformAdminGuard passed: admin, 2FA proven on this session). */
export interface PlatformContext {
  /** app_platform (BYPASSRLS): cross-shop reads only. */
  platformDb: Db;
  /** app_runtime: writes, each in the target shop's tenant transaction. */
  runtimeDb: Db;
  adminUserId: string;
  now: Date;
}
