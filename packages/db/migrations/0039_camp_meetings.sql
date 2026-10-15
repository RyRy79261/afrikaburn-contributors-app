ALTER TYPE "public"."notification_kind" ADD VALUE 'meeting';--> statement-breakpoint
CREATE TABLE "camp_meeting_attendees" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"marked_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "camp_meeting_attendees_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "camp_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"meeting_date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"location" text,
	"video_link" text,
	"audience" jsonb NOT NULL,
	"agenda_md" text DEFAULT '' NOT NULL,
	"notes_md" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancelled_at" timestamp,
	"cancelled_by_user_id" uuid,
	"notes_updated_at" timestamp,
	"notes_updated_by_user_id" uuid,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "camp_meetings_start_minute_in_day" CHECK ("camp_meetings"."start_minute" >= 0 and "camp_meetings"."start_minute" < 1440),
	CONSTRAINT "camp_meetings_duration_bounds" CHECK ("camp_meetings"."duration_minutes" > 0 and "camp_meetings"."duration_minutes" <= 1440),
	CONSTRAINT "camp_meetings_version_positive" CHECK ("camp_meetings"."version" >= 1),
	CONSTRAINT "camp_meetings_video_link_https" CHECK ("camp_meetings"."video_link" is null or "camp_meetings"."video_link" like 'https://%'),
	CONSTRAINT "camp_meetings_audience_is_this_camp" CHECK (("camp_meetings"."audience"->>'kind') = 'project' and ("camp_meetings"."audience"->>'groupId') = "camp_meetings"."group_id"::text),
	CONSTRAINT "camp_meetings_cancelled_by_needs_cancelled_at" CHECK ("camp_meetings"."cancelled_by_user_id" is null or "camp_meetings"."cancelled_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "camp_meeting_attendees" ADD CONSTRAINT "camp_meeting_attendees_meeting_id_camp_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."camp_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meeting_attendees" ADD CONSTRAINT "camp_meeting_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meeting_attendees" ADD CONSTRAINT "camp_meeting_attendees_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meetings" ADD CONSTRAINT "camp_meetings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meetings" ADD CONSTRAINT "camp_meetings_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meetings" ADD CONSTRAINT "camp_meetings_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meetings" ADD CONSTRAINT "camp_meetings_notes_updated_by_user_id_users_id_fk" FOREIGN KEY ("notes_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meetings" ADD CONSTRAINT "camp_meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_meetings" ADD CONSTRAINT "camp_meetings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "camp_meeting_attendees_user_idx" ON "camp_meeting_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "camp_meetings_group_edition_date_idx" ON "camp_meetings" USING btree ("group_id","edition_id","meeting_date");