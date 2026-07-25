CREATE TABLE "camp_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"label_normalized" text NOT NULL,
	"emoji" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_categories" (
	"group_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_categories_group_id_category_id_pk" PRIMARY KEY("group_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "camp_categories" ADD CONSTRAINT "camp_categories_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_categories" ADD CONSTRAINT "group_categories_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_categories" ADD CONSTRAINT "group_categories_category_id_camp_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."camp_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "camp_categories_edition_label_idx" ON "camp_categories" USING btree ("edition_id","label_normalized");--> statement-breakpoint
CREATE INDEX "camp_categories_edition_sort_idx" ON "camp_categories" USING btree ("edition_id","sort");--> statement-breakpoint
CREATE INDEX "group_categories_category_idx" ON "group_categories" USING btree ("category_id");