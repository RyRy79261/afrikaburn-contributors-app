ALTER TABLE "message_reports" ADD COLUMN "source_camp_name" text;--> statement-breakpoint
ALTER TABLE "message_reports" ADD COLUMN "source_team_name" text;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_source_both" CHECK (("message_reports"."source_camp_name" is null) = ("message_reports"."source_team_name" is null));