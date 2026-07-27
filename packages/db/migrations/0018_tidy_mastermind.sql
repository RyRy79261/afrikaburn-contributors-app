CREATE TYPE "public"."org_role_kind" AS ENUM('system', 'custom');--> statement-breakpoint
CREATE TABLE "org_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_role_assignments" (
	"membership_id" uuid NOT NULL,
	"org_role_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_role_assignments_membership_id_org_role_id_pk" PRIMARY KEY("membership_id","org_role_id")
);
--> statement-breakpoint
CREATE TABLE "org_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"description" text,
	"kind" "org_role_kind" DEFAULT 'custom' NOT NULL,
	"color" "role_color" DEFAULT 'neutral' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_role_assignments" ADD CONSTRAINT "org_role_assignments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_assignments" ADD CONSTRAINT "org_role_assignments_org_role_id_org_roles_id_fk" FOREIGN KEY ("org_role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_roles" ADD CONSTRAINT "org_roles_department_id_org_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."org_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_departments_key_idx" ON "org_departments" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "org_departments_name_normalized_idx" ON "org_departments" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "org_role_assignments_role_idx" ON "org_role_assignments" USING btree ("org_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_roles_key_idx" ON "org_roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "org_roles_name_normalized_idx" ON "org_roles" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "org_roles_department_idx" ON "org_roles" USING btree ("department_id");--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "department";--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "department_lead";