CREATE TYPE "public"."shift_signup_mode" AS ENUM('open', 'assign');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'shift';--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"offered_at" timestamp,
	"handover_to_membership_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_one_hand_on" CHECK ("shift_assignments"."offered_at" is null or "shift_assignments"."handover_to_membership_id" is null),
	CONSTRAINT "shift_assignments_not_to_self" CHECK ("shift_assignments"."handover_to_membership_id" is null or "shift_assignments"."handover_to_membership_id" <> "shift_assignments"."membership_id")
);
--> statement-breakpoint
CREATE TABLE "shift_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"shift_date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"capacity" integer NOT NULL,
	"required_role_id" uuid,
	"signup_mode" "shift_signup_mode" DEFAULT 'open' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_start_minute_in_day" CHECK ("shifts"."start_minute" >= 0 and "shifts"."start_minute" < 1440),
	CONSTRAINT "shifts_duration_bounds" CHECK ("shifts"."duration_minutes" >= 15 and "shifts"."duration_minutes" <= 1440),
	CONSTRAINT "shifts_capacity_bounds" CHECK ("shifts"."capacity" >= 1 and "shifts"."capacity" <= 50)
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "shift_teams_seeded_at" timestamp;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_handover_to_membership_id_memberships_id_fk" FOREIGN KEY ("handover_to_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_teams" ADD CONSTRAINT "shift_teams_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_team_id_shift_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."shift_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_required_role_id_project_roles_id_fk" FOREIGN KEY ("required_role_id") REFERENCES "public"."project_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_assignments_shift_membership_idx" ON "shift_assignments" USING btree ("shift_id","membership_id");--> statement-breakpoint
CREATE INDEX "shift_assignments_membership_idx" ON "shift_assignments" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "shift_assignments_handover_idx" ON "shift_assignments" USING btree ("handover_to_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_teams_group_name_idx" ON "shift_teams" USING btree ("group_id","name_normalized");--> statement-breakpoint
CREATE INDEX "shifts_group_edition_date_idx" ON "shifts" USING btree ("group_id","edition_id","shift_date");