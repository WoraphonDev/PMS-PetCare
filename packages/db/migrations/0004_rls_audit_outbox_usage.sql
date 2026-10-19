-- ADR-0003 RLS + append-only grants for audit_log, usage_event, outbox_event (T-0004).
-- Rows with org_id IS NULL never match the policy, so only app_platform (BYPASSRLS) can see or write them.

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "usage_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "usage_event"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "outbox_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_event"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- Append-only for the API: history cannot be rewritten from a request.
REVOKE UPDATE, DELETE ON "audit_log" FROM app_runtime;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "usage_event" FROM app_runtime;--> statement-breakpoint
-- The API only enqueues; the worker (app_platform) reads and marks events published.
REVOKE SELECT, UPDATE, DELETE ON "outbox_event" FROM app_runtime;
