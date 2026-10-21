ALTER TABLE "branch" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_version_positive" CHECK ("branch"."version" >= 1);