CREATE TYPE "public"."account_deletion_status" AS ENUM('pending', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."email_change_status" AS ENUM('pending', 'confirmed', 'revoked', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."supplier_document_source" AS ENUM('file', 'link');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "account_deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"grace_ends_at" timestamp NOT NULL,
	"cancelled_at" timestamp,
	"completed_at" timestamp,
	"requested_from_app" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"current_email" text NOT NULL,
	"new_email" text NOT NULL,
	"status" "email_change_status" DEFAULT 'pending' NOT NULL,
	"confirm_token_hash" text NOT NULL,
	"revoke_token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"revocable_until" timestamp,
	"revoked_at" timestamp,
	"provider_committed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_change_requests_confirm_token_hash_unique" UNIQUE("confirm_token_hash"),
	CONSTRAINT "email_change_requests_revoke_token_hash_unique" UNIQUE("revoke_token_hash")
);
--> statement-breakpoint
CREATE TABLE "supplier_document_acks" (
	"supplier_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"acked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_document_acks_supplier_id_document_id_pk" PRIMARY KEY("supplier_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" "supplier_document_source" DEFAULT 'link' NOT NULL,
	"url" text NOT NULL,
	"required_ack" boolean DEFAULT false NOT NULL,
	"step_key" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sanitized_at" timestamp;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_document_acks" ADD CONSTRAINT "supplier_document_acks_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_document_acks" ADD CONSTRAINT "supplier_document_acks_document_id_supplier_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."supplier_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_user_status_idx" ON "account_deletion_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "account_deletion_requests_due_idx" ON "account_deletion_requests" USING btree ("status","grace_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_one_pending_idx" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "email_change_requests_user_status_idx" ON "email_change_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_requests_one_pending_idx" ON "email_change_requests" USING btree ("user_id") WHERE "email_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "supplier_document_acks_document_idx" ON "supplier_document_acks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "supplier_documents_edition_sort_idx" ON "supplier_documents" USING btree ("edition_id","sort");--> statement-breakpoint
CREATE INDEX "supplier_documents_edition_step_idx" ON "supplier_documents" USING btree ("edition_id","step_key");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_code_unique" UNIQUE("code");