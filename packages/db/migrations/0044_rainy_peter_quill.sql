CREATE TABLE "camp_gas_fuel_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"record" jsonb NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"camp_notified_at" timestamp with time zone,
	"wrangler_notified_at" timestamp with time zone,
	"updated_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "s4_has_generator" boolean;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "s4_has_fire" boolean;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "s4_fire_kinds" jsonb;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "s4_has_gas_or_fuel" boolean;--> statement-breakpoint
ALTER TABLE "camp_gas_fuel_records" ADD CONSTRAINT "camp_gas_fuel_records_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_gas_fuel_records" ADD CONSTRAINT "camp_gas_fuel_records_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "camp_gas_fuel_records_registration_idx" ON "camp_gas_fuel_records" USING btree ("registration_id");