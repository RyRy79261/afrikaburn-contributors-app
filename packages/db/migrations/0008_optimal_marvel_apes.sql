CREATE TYPE "public"."supplier_returning" AS ENUM('newbie', 'returning');--> statement-breakpoint
ALTER TYPE "public"."supplier_standing" ADD VALUE 'diligent_first_timer';--> statement-breakpoint
ALTER TYPE "public"."supplier_standing" ADD VALUE 'adapting';--> statement-breakpoint
ALTER TYPE "public"."supplier_standing" ADD VALUE 'absolute_beginner';--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "returning" "supplier_returning";