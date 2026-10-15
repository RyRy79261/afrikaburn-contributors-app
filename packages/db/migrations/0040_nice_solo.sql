CREATE TYPE "public"."conversation_kind" AS ENUM('direct', 'team');--> statement-breakpoint
CREATE TYPE "public"."team_join_mode" AS ENUM('open', 'leads_add');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'team';--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "pair_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" "conversation_kind" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_teams" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "shift_teams" ADD COLUMN "join_mode" "team_join_mode" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_teams" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_shift_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."shift_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_shift_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."shift_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_unique" UNIQUE("team_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_keys" CHECK (("conversations"."kind" = 'direct' and "conversations"."pair_key" is not null and "conversations"."team_id" is null) or ("conversations"."kind" = 'team' and "conversations"."team_id" is not null and "conversations"."pair_key" is null));