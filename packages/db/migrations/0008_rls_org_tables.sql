-- ADR-0003 RLS for the T-0006 tenant tables; plan is platform-wide and written only by app_platform.

ALTER TABLE "branch_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branch_hours" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branch_hours"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "branch_closure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branch_closure" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branch_closure"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "membership_branch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_branch" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_branch"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitation"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscription"
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint

-- Plans and their prices are set by the platform, never from a shop request.
REVOKE INSERT, UPDATE, DELETE ON "plan" FROM app_runtime;
