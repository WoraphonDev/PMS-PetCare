CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"timezone" text DEFAULT 'Asia/Bangkok' NOT NULL,
	"promptpay_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_org_id_name_unique" UNIQUE("org_id","name"),
	CONSTRAINT "branch_timezone_mvp" CHECK ("branch"."timezone" = 'Asia/Bangkok')
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"phone" text,
	"logo_file_id" uuid,
	"receipt_footer" text,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organization_slug_format" CHECK ("organization"."slug" ~ '^[a-z0-9-]{3,40}$'),
	CONSTRAINT "organization_display_name_length" CHECK (char_length("organization"."display_name") between 1 and 100),
	CONSTRAINT "organization_tax_id_format" CHECK ("organization"."tax_id" ~ '^[0-9]{13}$'),
	CONSTRAINT "organization_receipt_footer_length" CHECK (char_length("organization"."receipt_footer") <= 500)
);
--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;