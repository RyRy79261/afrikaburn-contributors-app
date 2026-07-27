CREATE TABLE "org_department_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_department_domains" ADD CONSTRAINT "org_department_domains_department_id_org_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."org_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_department_domains_department_idx" ON "org_department_domains" USING btree ("department_id");