ALTER TABLE "editions" ADD COLUMN "registration_opens_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "registration_closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "camp_code" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "erf" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "carried_forward_from_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "carried_forward_at" timestamp;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_carried_forward_from_id_registrations_id_fk" FOREIGN KEY ("carried_forward_from_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_deadline_reminder_marker_idx" ON "audit_events" USING btree ("action","subject") WHERE "audit_events"."action" = 'registration.deadline_reminder';--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_edition_camp_code_idx" ON "registrations" USING btree ("edition_id","camp_code") WHERE "registrations"."camp_code" IS NOT NULL;