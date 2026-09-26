CREATE TYPE "public"."contactability" AS ENUM('nobody', 'camp_mates', 'anyone');--> statement-breakpoint
CREATE TABLE "registration_safety_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"expires_on" date NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "burner_bios" ADD COLUMN "contactable" "contactability" DEFAULT 'nobody' NOT NULL;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD COLUMN "listed_in_camp_people" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_role_assignments" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "registration_safety_documents" ADD CONSTRAINT "registration_safety_documents_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_safety_documents" ADD CONSTRAINT "registration_safety_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_safety_documents_registration_idx" ON "registration_safety_documents" USING btree ("registration_id");