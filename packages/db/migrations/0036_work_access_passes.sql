CREATE TYPE "public"."wap_list_status" AS ENUM('draft', 'submitted', 'approved', 'returned');--> statement-breakpoint
CREATE TYPE "public"."wap_request_status" AS ENUM('pending', 'granted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'wap';--> statement-breakpoint
CREATE TABLE "wap_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"allocated_by_user_id" uuid,
	"arrival_date" date,
	"departure_date" date,
	"build" boolean,
	"strike" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wap_allocations_arrival_before_departure" CHECK ("wap_allocations"."arrival_date" is null or "wap_allocations"."departure_date" is null or "wap_allocations"."arrival_date" <= "wap_allocations"."departure_date")
);
--> statement-breakpoint
CREATE TABLE "wap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"requested" integer NOT NULL,
	"reason" text,
	"status" "wap_request_status" DEFAULT 'pending' NOT NULL,
	"granted" integer,
	"requested_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wap_requests_requested_positive" CHECK ("wap_requests"."requested" > 0),
	CONSTRAINT "wap_requests_granted_within_ask" CHECK ("wap_requests"."granted" is null or ("wap_requests"."granted" > 0 and "wap_requests"."granted" <= "wap_requests"."requested")),
	CONSTRAINT "wap_requests_granted_iff_status" CHECK (("wap_requests"."status" = 'granted') = ("wap_requests"."granted" is not null))
);
--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "wap_requests_open_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "wap_requests_close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_status" "wap_list_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_return_note" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "wap_list_approved_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "wap_allocations" ADD CONSTRAINT "wap_allocations_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wap_allocations" ADD CONSTRAINT "wap_allocations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wap_allocations" ADD CONSTRAINT "wap_allocations_allocated_by_user_id_users_id_fk" FOREIGN KEY ("allocated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wap_requests" ADD CONSTRAINT "wap_requests_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wap_requests" ADD CONSTRAINT "wap_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wap_requests" ADD CONSTRAINT "wap_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wap_allocations_registration_membership_idx" ON "wap_allocations" USING btree ("registration_id","membership_id");--> statement-breakpoint
CREATE INDEX "wap_allocations_membership_idx" ON "wap_allocations" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "wap_requests_registration_idx" ON "wap_requests" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wap_requests_one_pending_idx" ON "wap_requests" USING btree ("registration_id") WHERE "wap_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_wap_list_submitted_by_user_id_users_id_fk" FOREIGN KEY ("wap_list_submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_wap_list_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("wap_list_reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;