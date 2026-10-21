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

/** A transaction owned by the caller with the organization context already set (ADR-0003). */
export interface TxContext {
  readonly tx: Tx;
  readonly orgId: string;
}

interface RoleProbe extends Record<string, unknown> {
  role: string;
  superuser: boolean;
  bypassrls: boolean;
  owns_tenant_tables: boolean;
}

/**
 * Sets the organization context on an **existing** transaction and hands it to `fn` as a {@link TxContext};
 * it never begins, commits or rolls back — the caller owns the transaction. Use it when identity and tenant
 * writes must land in one commit (foundation#rule-signup-atomic); `withTenant` stays the entry point for
 * callers that own no transaction yet.
 *
 * Fails closed before any DML if the transaction does not run as the runtime role: both `current_user` and
 * `session_user` must be non-superuser, NOBYPASSRLS and no member of the role owning the tenant tables, so a
 * platform (BYPASSRLS) or migrator (owner) connection can never silently bootstrap a tenant behind RLS.
 */
export function withTenantTx<T>(tx: Tx, orgId: string, fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  if (!UUID.test(orgId)) throw new TypeError("withTenantTx: orgId must be a UUID");
  return runOnTenantTx(tx, orgId, fn);
}

async function runOnTenantTx<T>(tx: Tx, orgId: string, fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  const probe = await tx.execute<RoleProbe>(sql`
    select r.rolname as role,
           r.rolsuper as superuser,
           r.rolbypassrls as bypassrls,
           pg_catalog.pg_has_role(r.rolname, (select relowner from pg_catalog.pg_class where oid = 'public.organization'::regclass), 'USAGE')
             as owns_tenant_tables
      from pg_catalog.pg_roles r
     where r.rolname in (current_user, session_user)
  `);
  if (probe.rows.length === 0) throw new Error("withTenantTx: cannot determine the role of this connection");
  for (const row of probe.rows) {
    if (row.superuser || row.bypassrls || row.owns_tenant_tables) {
      throw new Error(`withTenantTx: refusing to set the organization context on a connection running as "${row.role}"`);
    }
  }
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
  return fn({ tx, orgId });
}

/**
 * Runs `fn` in a transaction on the platform connection (`app_platform`, BYPASSRLS) for cross-organization work
 * such as platform admin and the outbox worker. Callers must write `audit_log` for every change they make.
 */
export function withPlatform<T>(platformDb: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return platformDb.transaction(fn);
}
