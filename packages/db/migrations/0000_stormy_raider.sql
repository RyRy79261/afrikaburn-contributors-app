CREATE TYPE "public"."activation_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."group_kind" AS ENUM('org', 'theme_camp', 'artwork', 'mutant_vehicle');--> statement-breakpoint
CREATE TYPE "public"."group_visibility" AS ENUM('default', 'public', 'members_only', 'private');--> statement-breakpoint
CREATE TYPE "public"."invite_kind" AS ENUM('member', 'lead_transfer');--> statement-breakpoint
CREATE TYPE "public"."joinability" AS ENUM('open', 'invite_only');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('god', 'org_staff', 'lead', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'reconciled', 'waived');--> statement-breakpoint
CREATE TYPE "public"."questionnaire_scope" AS ENUM('everyone', 'individual', 'opt_in');--> statement-breakpoint
CREATE TYPE "public"."questionnaire_status" AS ENUM('draft', 'published', 'unpublished');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."required_action_status" AS ENUM('pending', 'completed', 'waived', 'expired');--> statement-breakpoint
CREATE TYPE "public"."required_action_type" AS ENUM('questionnaire', 'acknowledgement', 'payment', 'profile_update');--> statement-breakpoint
CREATE TYPE "public"."section_key" AS ENUM('identity', 'lnt', 'participation', 'size_logistics', 'sound_placement', 'suppliers_commerce');--> statement-breakpoint
CREATE TYPE "public"."section_review_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."supplier_source" AS ENUM('ab_sheet', 'manual');--> statement-breakpoint
CREATE TYPE "public"."vetting_status" AS ENUM('listed', 'registered', 'flagged');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "burner_bios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"display_name" text,
	"legal_name" text,
	"home_city" text,
	"bio" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"previous_afrikaburns" integer DEFAULT 0 NOT NULL,
	"first_time" boolean DEFAULT false NOT NULL,
	"contact_email" text,
	"phone" text,
	"emergency_contact" jsonb,
	"medical_notes" text,
	"sa_id_encrypted" text,
	"passport_encrypted" text,
	"privacy_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "editions_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "group_kind" NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"joinability" "joinability" DEFAULT 'invite_only' NOT NULL,
	"visibility" "group_visibility" DEFAULT 'default' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"token" text NOT NULL,
	"kind" "invite_kind" DEFAULT 'member' NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp,
	"used_by_user_id" uuid,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"amount_cents" integer,
	"currency" text DEFAULT 'ZAR' NOT NULL,
	"reference" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"details" jsonb,
	"recorded_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "profile_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_key" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"scope" "questionnaire_scope" DEFAULT 'everyone' NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"status" "activation_status" DEFAULT 'draft' NOT NULL,
	"due_at" timestamp,
	"activated_by_user_id" uuid,
	"opened_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"definition" jsonb NOT NULL,
	"status" "questionnaire_status" DEFAULT 'draft' NOT NULL,
	"version" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"definition_key" text NOT NULL,
	"definition_version" text NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activation_id" uuid,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"status" "registration_status" DEFAULT 'draft' NOT NULL,
	"s1_contact_email" text,
	"s1_alt_contact_name" text,
	"s1_alt_contact_phone" text,
	"s1_alt_contact_email" text,
	"s2_lnt_plan" text,
	"s2_lnt_lead_name" text,
	"s2_lnt_lead_phone" text,
	"s2_lnt_lead_email" text,
	"s3_participation_plan" text,
	"s3_operating_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"s3_schedule_detail" text,
	"s3_gifting_food" boolean,
	"s4_expected_population" integer,
	"s4_first_arrival_date" date,
	"s4_work_access_passes" integer,
	"s4_area_dimensions" text,
	"s4_layout_upload_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"s5_amplified_music" text,
	"s5_sound_plan" text,
	"s5_placement_first_choice" text,
	"s5_placement_second_choice" text,
	"s5_neighbour_request" text,
	"s5_family_friendly" text,
	"s6_suppliers_note" text,
	"s6_paid_performers" boolean,
	"s6_fee_structure" text,
	"s6_expected_budget_zar" integer,
	"s6_plug_and_play_ack" boolean,
	"completed_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp,
	"decided_at" timestamp,
	"decided_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "required_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "required_action_type" NOT NULL,
	"action_key" text NOT NULL,
	"version" text,
	"activation_id" uuid,
	"title" text NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"status" "required_action_status" DEFAULT 'pending' NOT NULL,
	"due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "section_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"section_key" "section_key" NOT NULL,
	"status" "section_review_status" DEFAULT 'open' NOT NULL,
	"comment" text NOT NULL,
	"reviewer_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_declarations" (
	"registration_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_declarations_registration_id_supplier_id_pk" PRIMARY KEY("registration_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"services" text,
	"contact" text,
	"website" text,
	"vetting_status" "vetting_status" DEFAULT 'listed' NOT NULL,
	"source" "supplier_source" DEFAULT 'manual' NOT NULL,
	"imported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD CONSTRAINT "burner_bios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burner_bios" ADD CONSTRAINT "burner_bios_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_keys" ADD CONSTRAINT "profile_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_activations" ADD CONSTRAINT "questionnaire_activations_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_definitions" ADD CONSTRAINT "questionnaire_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_activation_id_questionnaire_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."questionnaire_activations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "required_actions" ADD CONSTRAINT "required_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "required_actions" ADD CONSTRAINT "required_actions_activation_id_questionnaire_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."questionnaire_activations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_reviews" ADD CONSTRAINT "section_reviews_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_reviews" ADD CONSTRAINT "section_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_declarations" ADD CONSTRAINT "supplier_declarations_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_declarations" ADD CONSTRAINT "supplier_declarations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "burner_bios_user_edition_idx" ON "burner_bios" USING btree ("user_id","edition_id");--> statement-breakpoint
CREATE INDEX "burner_bios_edition_idx" ON "burner_bios" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_kind_name_normalized_idx" ON "groups" USING btree ("kind","name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_slug_idx" ON "groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "invites_group_idx" ON "invites" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_group_idx" ON "memberships" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE INDEX "memberships_group_idx" ON "memberships" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "payments_subject_idx" ON "payments" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "questionnaire_activations_key_idx" ON "questionnaire_activations" USING btree ("questionnaire_key");--> statement-breakpoint
CREATE INDEX "questionnaire_activations_status_idx" ON "questionnaire_activations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_user_def_idx" ON "questionnaire_responses" USING btree ("user_id","definition_key");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_def_idx" ON "questionnaire_responses" USING btree ("definition_key");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_group_edition_idx" ON "registrations" USING btree ("group_id","edition_id");--> statement-breakpoint
CREATE INDEX "registrations_edition_status_idx" ON "registrations" USING btree ("edition_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "required_actions_user_action_idx" ON "required_actions" USING btree ("user_id","action_key");--> statement-breakpoint
CREATE INDEX "required_actions_user_status_idx" ON "required_actions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "section_reviews_registration_idx" ON "section_reviews" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "supplier_declarations_supplier_idx" ON "supplier_declarations" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "suppliers_vetting_idx" ON "suppliers" USING btree ("vetting_status");