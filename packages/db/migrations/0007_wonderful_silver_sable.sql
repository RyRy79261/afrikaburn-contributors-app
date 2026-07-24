CREATE TYPE "public"."supplier_note_kind" AS ENUM('infraction', 'blessing', 'note');--> statement-breakpoint
CREATE TYPE "public"."supplier_standing" AS ENUM('good', 'watch', 'suspended');--> statement-breakpoint
CREATE TABLE "supplier_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" "supplier_note_kind" DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_onboarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "suppliers_vetting_idx";--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "standing" "supplier_standing" DEFAULT 'good' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_notes" ADD CONSTRAINT "supplier_notes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_notes" ADD CONSTRAINT "supplier_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_onboarding" ADD CONSTRAINT "supplier_onboarding_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_onboarding" ADD CONSTRAINT "supplier_onboarding_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_notes_supplier_idx" ON "supplier_notes" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_onboarding_supplier_edition_idx" ON "supplier_onboarding" USING btree ("supplier_id","edition_id");--> statement-breakpoint
CREATE INDEX "supplier_onboarding_edition_idx" ON "supplier_onboarding" USING btree ("edition_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppliers_standing_idx" ON "suppliers" USING btree ("standing");--> statement-breakpoint
CREATE INDEX "suppliers_user_idx" ON "suppliers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "vetting_status";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "source";--> statement-breakpoint
DROP TYPE "public"."supplier_source";--> statement-breakpoint
DROP TYPE "public"."vetting_status";