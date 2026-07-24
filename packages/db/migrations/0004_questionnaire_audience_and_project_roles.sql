CREATE TYPE "public"."questionnaire_authored_scope" AS ENUM('org', 'group');--> statement-breakpoint
CREATE TABLE "member_role_assignments" (
	"membership_id" uuid NOT NULL,
	"project_role_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_role_assignments_membership_id_project_role_id_pk" PRIMARY KEY("membership_id","project_role_id")
);
--> statement-breakpoint
CREATE TABLE "project_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD COLUMN "authored_scope" "questionnaire_authored_scope" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD COLUMN "edition_id" uuid;--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD COLUMN "audience" jsonb;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "grants_interest" boolean;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_project_role_id_project_roles_id_fk" FOREIGN KEY ("project_role_id") REFERENCES "public"."project_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_role_assignments_role_idx" ON "member_role_assignments" USING btree ("project_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_roles_group_name_normalized_idx" ON "project_roles" USING btree ("group_id","name_normalized");--> statement-breakpoint
CREATE INDEX "project_roles_group_idx" ON "project_roles" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD CONSTRAINT "questionnaire_activations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD CONSTRAINT "questionnaire_activations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questionnaire_activations_group_idx" ON "questionnaire_activations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "questionnaire_activations_edition_idx" ON "questionnaire_activations" USING btree ("edition_id");