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
--
-- `timestamptz`, NOT `timestamp`, and this is the one place in the schema where
-- the distinction is load-bearing. A bare `timestamp` carries no zone, so the
-- driver hands it back interpreted in the Node process's local timezone — and
-- the reminder job then does UTC calendar arithmetic against it. On any runner
-- not set to UTC, "closes 2027-09-30 23:59" becomes a different instant, and a
-- deadline that moves depending on where the process runs is not a deadline.
-- Every other column here is a record of something that happened; these two are
-- a promise that gets compared against `now`.
--
-- The rest of the schema's `timestamp` convention is deliberately untouched —
-- converting it wholesale is a separate migration and not this change's job.
ALTER TABLE "editions"
  ADD COLUMN IF NOT EXISTS "registration_opens_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "editions"
  ADD COLUMN IF NOT EXISTS "registration_closes_at" timestamptz;
--> statement-breakpoint

-- CONVERGENCE for any database that applied an earlier draft of this migration
-- (a preview branch), where these columns landed as bare `timestamp`. A no-op on
-- a fresh database, and safe regardless: both columns are NULL everywhere, since
-- no edition has had a registration window set.
ALTER TABLE "editions"
  ALTER COLUMN "registration_opens_at" TYPE timestamptz,
  ALTER COLUMN "registration_closes_at" TYPE timestamptz;
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
--
-- NOT `CONCURRENTLY`, deliberately. A plain unique index build takes a lock that
-- blocks writes to `registrations` while it runs, and review flagged that.
-- `CONCURRENTLY` cannot run inside a transaction and the migrator wraps every
-- migration in one, so adopting it means special-casing the runner. Against this
-- table it would buy nothing measurable: `registrations` holds one row per camp
-- per edition — AfrikaBurn places a few hundred camps — so the build is a
-- sub-second lock on a table with three digits of rows. Revisit if that ever
-- stops being true.
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
