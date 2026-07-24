ALTER TABLE "memberships" ADD COLUMN "ref_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_group_ref_code_idx" ON "memberships" USING btree ("group_id","ref_code");