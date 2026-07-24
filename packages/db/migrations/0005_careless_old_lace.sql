CREATE TYPE "public"."project_role_kind" AS ENUM('captain', 'baseline', 'default', 'custom', 'officer');--> statement-breakpoint
CREATE TYPE "public"."role_assignment_consent" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."role_color" AS ENUM('teal', 'teal_deep', 'apricot', 'peach', 'sage', 'olive', 'rust', 'neutral');--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD COLUMN "consent_status" "role_assignment_consent" DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD COLUMN "org_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "kind" "project_role_kind" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "color" "role_color" DEFAULT 'neutral' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "officer_key" text;