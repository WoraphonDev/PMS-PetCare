# @app/db

Drizzle schema, SQL migrations and the tenancy helpers (ADR-0003).

## Commands

```bash
pnpm --filter @app/db generate -- --name <slug>              # schema change → new SQL migration (commit it)
pnpm --filter @app/db exec drizzle-kit generate --custom --name <slug>   # empty migration for RLS / constraints Drizzle can't express
pnpm --filter @app/db test                                    # Postgres 17 via Testcontainers (needs Docker)
```

Never edit a migration after it is merged. Never run `drizzle-kit push`.

## Roles

| role | used by | RLS |
|---|---|---|
| `app_migrator` | migrations (owns tables) | forced on its tables too |
| `app_runtime` | API requests — always through `withTenant(db, orgId, fn)` | applies (`NOBYPASSRLS`) |
| `app_platform` | platform admin, outbox worker — `withPlatform(db, fn)`; callers write `audit_log` | bypassed (`BYPASSRLS`) |

`test/support/test-db.ts` creates these roles and their default privileges; production uses the same SQL (ops runbook, later card).

## Tenant rules

- Every table with `org_id` must `ENABLE` + `FORCE ROW LEVEL SECURITY` and have a policy on
  `nullif(current_setting('app.org_id', true), '')::uuid` — `test/rls-coverage.test.ts` fails otherwise.
- `withTenant` sets `app.org_id` with `is_local = true` (transaction-scoped), so it never leaks across pooled connections.

## Docker on macOS with Colima

Testcontainers does not read Docker contexts. Either export the socket:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

or link it once: `sudo ln -sf "$HOME/.colima/default/docker.sock" /var/run/docker.sock`.
