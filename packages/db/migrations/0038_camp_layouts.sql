CREATE TABLE "camp_layout_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"registration_submitted_at" timestamp NOT NULL,
	"pinned_at" timestamp DEFAULT now() NOT NULL,
	"pinned_by_user_id" uuid,
	CONSTRAINT "camp_layout_snapshots_version_positive" CHECK ("camp_layout_snapshots"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "camp_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "camp_layouts_version_positive" CHECK ("camp_layouts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "camp_layout_snapshots" ADD CONSTRAINT "camp_layout_snapshots_layout_id_camp_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."camp_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_layout_snapshots" ADD CONSTRAINT "camp_layout_snapshots_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_layout_snapshots" ADD CONSTRAINT "camp_layout_snapshots_pinned_by_user_id_users_id_fk" FOREIGN KEY ("pinned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_layouts" ADD CONSTRAINT "camp_layouts_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_layouts" ADD CONSTRAINT "camp_layouts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_layouts" ADD CONSTRAINT "camp_layouts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "camp_layout_snapshots_registration_pinned_idx" ON "camp_layout_snapshots" USING btree ("registration_id","pinned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "camp_layout_snapshots_layout_idx" ON "camp_layout_snapshots" USING btree ("layout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "camp_layouts_registration_idx" ON "camp_layouts" USING btree ("registration_id");