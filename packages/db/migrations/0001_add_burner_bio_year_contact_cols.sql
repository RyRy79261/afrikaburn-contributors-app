ALTER TABLE "burner_bios" ADD COLUMN "attended_years" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD COLUMN "onsite_contact_name" text;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD COLUMN "onsite_contact_phone" text;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD COLUMN "offsite_contact_name" text;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD COLUMN "offsite_contact_phone" text;