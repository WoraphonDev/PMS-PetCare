import type { organization, Tx } from "@app/db";
import type { Clock, Role } from "@app/domain";
import type { UserRow } from "../modules/identity";
import { AppError } from "./app-error";

/** Base context also supports public, non-tenant endpoints such as liveness. */
export interface RequestContext {
  requestId: string;
  now: Date;
  buildSha: string;
  user?: UserRow | null;
  org?: typeof organization.$inferSelect;
  membership?: { id: string; role: Role; branchIds: readonly string[] };
  /** null means organization-wide; otherwise exactly the assigned branch ids. */
  branchScope?: readonly string[] | null;
  db?: TenantDb;
}
export interface TenantDb {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
export interface OrgRequestContext extends RequestContext {
  user: UserRow;
  org: typeof organization.$inferSelect;
  membership: NonNullable<RequestContext["membership"]>;
  branchScope: readonly string[] | null;
  db: TenantDb;
}

/** Org-wide callers must still load the resource through ctx.db so RLS checks its organization. */
export function assertBranchInScope(ctx: OrgRequestContext, branchId: string): void {
  if (ctx.branchScope !== null && !ctx.branchScope.includes(branchId)) throw new AppError("NOT_FOUND");
}

export const CLOCK = Symbol("CLOCK");
export const CONFIG = Symbol("CONFIG");
export type { Clock };
