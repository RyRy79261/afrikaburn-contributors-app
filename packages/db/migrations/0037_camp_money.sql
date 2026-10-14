CREATE TYPE "public"."budget_category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."budget_entry_status" AS ENUM('committed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."camp_budget_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."camp_claim_status" AS ENUM('submitted', 'approved', 'rejected', 'repaid');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'money';--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"kind" "budget_category_kind" NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"planned_cents" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"system_key" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_categories_planned_non_negative" CHECK ("budget_categories"."planned_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"status" "budget_entry_status" DEFAULT 'paid' NOT NULL,
	"receipt_key" text,
	"receipt_content_type" text,
	"entered_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_entries_amount_positive" CHECK ("budget_entries"."amount_cents" > 0),
	CONSTRAINT "budget_entries_receipt_paired" CHECK (("budget_entries"."receipt_key" is null) = ("budget_entries"."receipt_content_type" is null))
);
--> statement-breakpoint
CREATE TABLE "camp_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"default_dues_cents" integer DEFAULT 0 NOT NULL,
	"payment_instructions" text,
	"contingency_pct" integer DEFAULT 0 NOT NULL,
	"status" "camp_budget_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"approved_by_user_id" uuid,
	"categories_seeded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "camp_budgets_default_dues_non_negative" CHECK ("camp_budgets"."default_dues_cents" >= 0),
	CONSTRAINT "camp_budgets_contingency_pct_bounds" CHECK ("camp_budgets"."contingency_pct" >= 0 and "camp_budgets"."contingency_pct" <= 100),
	CONSTRAINT "camp_budgets_approved_iff_stamped" CHECK (("camp_budgets"."status" = 'approved') = ("camp_budgets"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "camp_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"claimant_user_id" uuid,
	"category_id" uuid,
	"amount_cents" integer NOT NULL,
	"description" text,
	"receipt_key" text,
	"receipt_content_type" text,
	"status" "camp_claim_status" DEFAULT 'submitted' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp,
	"decision_note" text,
	"repaid_on" date,
	"repaid_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "camp_claims_amount_positive" CHECK ("camp_claims"."amount_cents" > 0),
	CONSTRAINT "camp_claims_decided_iff_not_submitted" CHECK (("camp_claims"."status" = 'submitted') = ("camp_claims"."decided_at" is null)),
	CONSTRAINT "camp_claims_repaid_on_iff_repaid" CHECK (("camp_claims"."status" = 'repaid') = ("camp_claims"."repaid_on" is not null)),
	CONSTRAINT "camp_claims_approved_has_category" CHECK ("camp_claims"."status" not in ('approved', 'repaid') or "camp_claims"."category_id" is not null),
	CONSTRAINT "camp_claims_not_decided_by_self" CHECK ("camp_claims"."decided_by_user_id" is null or "camp_claims"."claimant_user_id" is null or "camp_claims"."decided_by_user_id" <> "camp_claims"."claimant_user_id"),
	CONSTRAINT "camp_claims_not_repaid_by_self" CHECK ("camp_claims"."repaid_by_user_id" is null or "camp_claims"."claimant_user_id" is null or "camp_claims"."repaid_by_user_id" <> "camp_claims"."claimant_user_id"),
	CONSTRAINT "camp_claims_receipt_paired" CHECK (("camp_claims"."receipt_key" is null) = ("camp_claims"."receipt_content_type" is null))
);
--> statement-breakpoint
CREATE TABLE "dues_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"user_id" uuid,
	"amount_cents" integer NOT NULL,
	"received_on" date NOT NULL,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dues_payments_amount_positive" CHECK ("dues_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "member_dues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"user_id" uuid,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"set_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_dues_amount_non_negative" CHECK ("member_dues"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_budgets" ADD CONSTRAINT "camp_budgets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_budgets" ADD CONSTRAINT "camp_budgets_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_budgets" ADD CONSTRAINT "camp_budgets_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_claims" ADD CONSTRAINT "camp_claims_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_claims" ADD CONSTRAINT "camp_claims_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_claims" ADD CONSTRAINT "camp_claims_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_claims" ADD CONSTRAINT "camp_claims_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_claims" ADD CONSTRAINT "camp_claims_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "camp_claims" ADD CONSTRAINT "camp_claims_repaid_by_user_id_users_id_fk" FOREIGN KEY ("repaid_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_dues" ADD CONSTRAINT "member_dues_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_group_edition_name_idx" ON "budget_categories" USING btree ("group_id","edition_id","name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_system_key_idx" ON "budget_categories" USING btree ("group_id","edition_id","system_key") WHERE "budget_categories"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "budget_entries_group_edition_idx" ON "budget_entries" USING btree ("group_id","edition_id","entry_date");--> statement-breakpoint
CREATE INDEX "budget_entries_category_idx" ON "budget_entries" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "camp_budgets_group_edition_idx" ON "camp_budgets" USING btree ("group_id","edition_id");--> statement-breakpoint
CREATE INDEX "camp_claims_group_edition_status_idx" ON "camp_claims" USING btree ("group_id","edition_id","status");--> statement-breakpoint
CREATE INDEX "camp_claims_claimant_idx" ON "camp_claims" USING btree ("claimant_user_id");--> statement-breakpoint
CREATE INDEX "camp_claims_category_idx" ON "camp_claims" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "dues_payments_group_edition_user_idx" ON "dues_payments" USING btree ("group_id","edition_id","user_id");--> statement-breakpoint
CREATE INDEX "dues_payments_user_idx" ON "dues_payments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_dues_group_edition_user_idx" ON "member_dues" USING btree ("group_id","edition_id","user_id");--> statement-breakpoint
CREATE INDEX "member_dues_user_idx" ON "member_dues" USING btree ("user_id");