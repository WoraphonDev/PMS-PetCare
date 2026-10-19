CREATE TYPE "public"."membership_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'manager', 'front_desk', 'groomer', 'caretaker');--> statement-breakpoint
CREATE TABLE "branch_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_closure_dates" CHECK ("branch_closure"."start_date" <= "branch_closure"."end_date")
);
--> statement-breakpoint
CREATE TABLE "branch_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_hours_branch_id_weekday_unique" UNIQUE("branch_id","weekday"),
	CONSTRAINT "branch_hours_weekday_iso" CHECK ("branch_hours"."weekday" between 1 and 7),
	CONSTRAINT "branch_hours_open_close" CHECK (("branch_hours"."opens_at" is null and "branch_hours"."closes_at" is null) or ("branch_hours"."opens_at" is not null and "branch_hours"."closes_at" is not null and "branch_hours"."opens_at" < "branch_hours"."closes_at"))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" "staff_role" NOT NULL,
	"branch_ids" uuid[] NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"display_name" text NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_org_id_user_id_unique" UNIQUE("org_id","user_id"),
	CONSTRAINT "membership_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "membership_branch" (
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_branch_pk" PRIMARY KEY("membership_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"max_branches" integer,
	"max_staff" integer,
	"price_satang_per_month" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_code_unique" UNIQUE("code"),
	CONSTRAINT "plan_price_non_negative" CHECK ("plan"."price_satang_per_month" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_orgId_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "outbox_event" DROP CONSTRAINT "outbox_event_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_event" DROP CONSTRAINT "usage_event_branch_id_branch_id_fk";
--> statement-breakpoint
-- must exist before the composite FKs below reference it (moved up from drizzle-kit's order)
ALTER TABLE "branch" ADD CONSTRAINT "branch_org_id_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "branch_closure" ADD CONSTRAINT "branch_closure_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_closure" ADD CONSTRAINT "branch_closure_branch_fk" FOREIGN KEY ("org_id","branch_id") REFERENCES "public"."branch"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_fk" FOREIGN KEY ("org_id","branch_id") REFERENCES "public"."branch"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_branch" ADD CONSTRAINT "membership_branch_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_branch" ADD CONSTRAINT "membership_branch_branch_fk" FOREIGN KEY ("org_id","branch_id") REFERENCES "public"."branch"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_branch" ADD CONSTRAINT "membership_branch_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."membership"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_branch_fk" FOREIGN KEY ("org_id","branch_id") REFERENCES "public"."branch"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_branch_fk" FOREIGN KEY ("org_id","branch_id") REFERENCES "public"."branch"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_branch_needs_org" CHECK ("outbox_event"."branch_id" is null or "outbox_event"."org_id" is not null);