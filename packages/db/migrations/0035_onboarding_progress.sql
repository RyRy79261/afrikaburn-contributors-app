CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"furthest_step" integer DEFAULT 1 NOT NULL,
	"acknowledged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_activation_id_questionnaire_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."questionnaire_activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_progress_activation_user_idx" ON "onboarding_progress" USING btree ("activation_id","user_id");