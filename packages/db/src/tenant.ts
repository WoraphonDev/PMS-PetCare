import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction scoped to one organization (ADR-0003).
 * `app.org_id` is set with `is_local = true`, so it ends with the transaction and never leaks to the next
 * user of the pooled connection. RLS policies compare every row's `org_id` with this setting.
 * `db` must connect as the runtime role (`app_runtime`, NOBYPASSRLS).
 */
export function withTenant<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(orgId)) throw new TypeError("withTenant: orgId must be a UUID");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction on the platform connection (`app_platform`, BYPASSRLS) for cross-organization work
 * such as platform admin and the outbox worker. Callers must write `audit_log` for every change they make.
 */
export function withPlatform<T>(platformDb: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return platformDb.transaction(fn);
}
