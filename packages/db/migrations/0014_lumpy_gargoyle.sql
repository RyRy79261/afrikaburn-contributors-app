CREATE TYPE "public"."security_event_kind" AS ENUM('password_changed', 'password_reset_completed', 'session_revoked', 'sessions_revoked_others', 'email_change_requested', 'email_change_confirmed', 'email_change_revoked', 'deletion_requested', 'deletion_cancelled');--> statement-breakpoint
CREATE TABLE "section_review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "security_event_kind" NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_review_replies" ADD CONSTRAINT "section_review_replies_review_id_section_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."section_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_review_replies" ADD CONSTRAINT "section_review_replies_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "section_review_replies_review_idx" ON "section_review_replies" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "security_events_user_created_idx" ON "security_events" USING btree ("user_id","created_at" DESC NULLS LAST);