ALTER TYPE "public"."membership_role" ADD VALUE 'engineer';--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "department_lead" boolean DEFAULT false NOT NULL;