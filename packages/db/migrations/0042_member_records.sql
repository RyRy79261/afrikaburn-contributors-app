CREATE TABLE "member_duplicate_dismissals" (
	"group_id" uuid NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"dismissed_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_duplicate_dismissals_group_id_user_a_id_user_b_id_pk" PRIMARY KEY("group_id","user_a_id","user_b_id"),
	CONSTRAINT "member_duplicate_dismissals_ordered_pair" CHECK ("member_duplicate_dismissals"."user_a_id" < "member_duplicate_dismissals"."user_b_id")
);
--> statement-breakpoint
CREATE TABLE "member_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"edited_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_notes_body_length" CHECK (char_length("member_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "member_duplicate_dismissals" ADD CONSTRAINT "member_duplicate_dismissals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_duplicate_dismissals" ADD CONSTRAINT "member_duplicate_dismissals_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_duplicate_dismissals" ADD CONSTRAINT "member_duplicate_dismissals_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_duplicate_dismissals" ADD CONSTRAINT "member_duplicate_dismissals_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_duplicate_dismissals_user_b_idx" ON "member_duplicate_dismissals" USING btree ("user_b_id");--> statement-breakpoint
CREATE INDEX "member_duplicate_dismissals_user_a_idx" ON "member_duplicate_dismissals" USING btree ("user_a_id");--> statement-breakpoint
CREATE INDEX "member_notes_group_subject_idx" ON "member_notes" USING btree ("group_id","subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "member_notes_subject_idx" ON "member_notes" USING btree ("subject_user_id");