ALTER TABLE "memberships" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;