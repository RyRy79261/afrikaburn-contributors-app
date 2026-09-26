CREATE TYPE "public"."bulletin_presentation" AS ENUM('feed', 'acknowledge');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_report_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."message_timer" AS ENUM('off', '24h', '7d', '90d');--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_read_at" timestamp,
	"hidden_at" timestamp,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_key" text NOT NULL,
	"timer" "message_timer" DEFAULT 'off' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp,
	CONSTRAINT "conversations_pair_key_unique" UNIQUE("pair_key")
);
--> statement-breakpoint
CREATE TABLE "message_report_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"original_message_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" "message_kind" NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reporter_id" uuid,
	"reported_user_id" uuid,
	"reason" text,
	"status" "message_report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "presentation" "bulletin_presentation" DEFAULT 'feed' NOT NULL;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "pin_on_publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "pinned_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "send_at" timestamp;--> statement-breakpoint
ALTER TABLE "bulletins" ADD COLUMN "dispatched_at" timestamp;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "acknowledged_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_message_timer" "message_timer" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_report_items" ADD CONSTRAINT "message_report_items_report_id_message_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."message_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_report_items" ADD CONSTRAINT "message_report_items_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_report_items_report_idx" ON "message_report_items" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "message_reports_status_created_idx" ON "message_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_reports_expires_at_idx" ON "message_reports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_expires_at_idx" ON "messages" USING btree ("expires_at") WHERE "messages"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_pinned_by_user_id_users_id_fk" FOREIGN KEY ("pinned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulletins_group_created_idx" ON "bulletins" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "bulletins_dispatch_due_idx" ON "bulletins" USING btree ("send_at") WHERE "bulletins"."published_at" is not null and "bulletins"."dispatched_at" is null and "bulletins"."send_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_bulletin_user_idx" ON "notifications" USING btree ("bulletin_id","user_id") WHERE "notifications"."bulletin_id" is not null;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_camp_audience_matches_group" CHECK (("bulletins"."group_id" is null and ("bulletins"."audience"->>'kind') <> 'project') or ("bulletins"."group_id" is not null and ("bulletins"."audience"->>'kind') = 'project' and ("bulletins"."audience"->>'groupId') = "bulletins"."group_id"::text));