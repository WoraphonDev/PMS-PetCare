-- ADR-0003: tenant isolation with Row-Level Security.
-- app.org_id is set per transaction by withTenant(); nullif() turns the empty string left on a pooled
-- connection after a previous transaction into NULL, so "no context" matches no rows instead of erroring.
-- FORCE applies the policies to the table owner too; only roles with BYPASSRLS (app_platform) skip them.

ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organization"
  USING ("id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "branch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branch" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branch"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
