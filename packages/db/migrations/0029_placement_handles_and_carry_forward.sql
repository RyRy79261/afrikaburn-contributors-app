-- R1 registration-season readiness (roadmap R1): the registration window, the
-- two staff-assigned placement handles, and previous-year duplication.
--
-- HAND-AUTHORED, like 0024–0028, and idempotent throughout. `pnpm db:generate`
-- cannot produce this file: the drizzle snapshot chain stops at 0023, so
-- drizzle-kit diffs schema.ts against a five-migration-old picture of the
-- database and emits a migration that re-creates `wrangler_assignments` and
-- re-adds `decision_reason`, `consent_edition_id` and `questionnaire_responses.
-- group_id`. Against the live database that is a hard failure at the first
-- CREATE TABLE. Every statement below is written to be safely re-runnable.
--
-- ## 1. The registration window
--
-- Form 1 opens in September and closes on a date AfrikaBurn publishes. Nothing
-- in the schema held either date, so the deadline job had no deadline to count
-- against and the camp-facing screens had nothing to display.
--
-- BOTH NULLABLE, and null is load-bearing rather than lazy: the 2027 opening
-- date is an open blocker owned by AfrikaBurn (roadmap §"What we need from
-- others"). The reminder job reads null as "no deadline set, remind nobody",
-- which is the only honest behaviour — a countdown to a date nobody has decided
-- is an invented deadline, and camps would plan around it.
--
-- Timestamps rather than dates because "closes 23:59" and "closes 09:00" are
-- different promises and the announcement will say which.
ALTER TABLE "editions"
  ADD COLUMN IF NOT EXISTS "registration_opens_at" timestamp;
--> statement-breakpoint

ALTER TABLE "editions"
  ADD COLUMN IF NOT EXISTS "registration_closes_at" timestamp;
--> statement-breakpoint

-- ## 2. Staff-assigned camp code + erf
--
-- Roadmap R1: "Staff-assigned ERFs + camp codes on profiles — unblocks container
-- booking without any placement tool."
--
-- THE ERF IS `text` ON PURPOSE. App Spec §13 (map + erf placement) is blocked on
-- AfrikaBurn's own mapping process — there is no structured erf data, the
-- official map is a late PDF, and the layout changes every year. A structured
-- column here would encode a format we invented, which AfrikaBurn would then be
-- obliged to match. It is a label a staff member types; normalization lives in
-- @quagga/core `placement-codes` and is the single thing that changes when a
-- real grammar arrives.
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "camp_code" text;
--> statement-breakpoint

ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "erf" text;
--> statement-breakpoint

-- PARTIAL UNIQUE, SCOPED TO THE EDITION.
--
-- Partial (`WHERE camp_code IS NOT NULL`) because at the moment this migration
-- runs every existing registration has a NULL code, and a plain unique index
-- would be fine today only because Postgres treats NULLs as distinct — a
-- guarantee it is unwise to lean on when the intent is "unassigned rows do not
-- participate". Saying so explicitly costs nothing and cannot be misread.
--
-- Per-edition rather than global because codes are REUSED: the same camp keeps
-- MAH year after year, and a camp that sits out 2028 must not find its own code
-- taken by its own history in 2029.
CREATE UNIQUE INDEX IF NOT EXISTS "registrations_edition_camp_code_idx"
  ON "registrations" ("edition_id", "camp_code")
  WHERE "camp_code" IS NOT NULL;
--> statement-breakpoint

-- ## 3. Previous-year duplication
--
-- Roadmap R1's flagship fewer-forms feature: a returning camp confirms deltas
-- instead of re-entering 400 words about how it will leave no trace. The column
-- records which registration a draft was seeded from, so both the camp and the
-- reviewer can be shown what actually moved.
--
-- SELF-REFERENCING, `ON DELETE SET NULL`. Cascade would be actively wrong: if
-- last year's row is ever removed, this year's registration is still completely
-- valid — it simply loses the ability to render a comparison. Cascading would
-- delete a live registration as a side effect of a historical cleanup.
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "carried_forward_from_id" uuid;
--> statement-breakpoint

ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "carried_forward_at" timestamp;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registrations_carried_forward_from_id_registrations_id_fk'
  ) THEN
    ALTER TABLE "registrations"
      ADD CONSTRAINT "registrations_carried_forward_from_id_registrations_id_fk"
      FOREIGN KEY ("carried_forward_from_id") REFERENCES "registrations"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
