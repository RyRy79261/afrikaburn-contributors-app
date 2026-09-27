CREATE TABLE "membership_logistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"joining_build" boolean DEFAULT false NOT NULL,
	"joining_strike" boolean DEFAULT false NOT NULL,
	"arrival_date" date,
	"departure_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "membership_logistics_arrival_before_departure" CHECK ("membership_logistics"."arrival_date" is null or "membership_logistics"."departure_date" is null or "membership_logistics"."arrival_date" <= "membership_logistics"."departure_date")
);
--> statement-breakpoint
ALTER TABLE "membership_logistics" ADD CONSTRAINT "membership_logistics_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_logistics" ADD CONSTRAINT "membership_logistics_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_logistics_membership_edition_idx" ON "membership_logistics" USING btree ("membership_id","edition_id");