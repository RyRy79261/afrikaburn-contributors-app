-- Four corrections and one repair, 29 Jul 2026.
--
-- 0022 shipped with two data mistakes; the other three items here are defects
-- 0022 had nothing to do with. Migrations are append-only, so 0022 stands as
-- written and this one corrects what it left behind.
--
--   1. The Theme camps department's `name_normalized` was hand-written as
--      'theme camps' — a value the application's normalizer cannot produce.
--   2. `manage_camp_categories` was mapped to create + update + DELETE, so
--      roles defined as never-destructive could come out of 0022 holding
--      destruction.
--   3. `required_actions` was keyed (user, action_key), so the Burner Bio gate
--      could never fire in a second edition.
--   4. `audit_events` — the one table here that only grows — had no index on
--      `subject` or `created_at`.
--   5. Our own rate-limit counters lived in a table Better Auth garbage-
--      collects, which collapsed a 15-minute budget to about a minute.

-- ---------------------------------------------------------------------------
-- 1. The Theme camps department could never be found by name.
--
-- `org_departments.name_normalized` is the CASE/SPACE/PUNCTUATION-INSENSITIVE
-- uniqueness key, produced by @quagga/core `normalizeName`, which lowercases,
-- strips diacritics and REMOVES EVERY NON-ALPHANUMERIC CHARACTER — spaces
-- included. normalizeName('Theme camps') is 'themecamps'. 0022 inserted the row
-- with 'theme camps', a string that normalizer cannot emit for any input.
--
-- Two things silently stopped working:
--   · `org_departments_name_normalized_idx`, the UNIQUE index this column
--     exists for, could not collide with anything the console stores — so a
--     System manager could create a second department called "Theme Camps",
--     "theme-camps" or "themecamps" and the database would accept it. Two
--     departments with the same name, one of them undeletable.
--   · the console's own duplicate check compares `normalizeOrgName(candidate)`
--     against the stored keys, so it read "Theme camps" as free and offered no
--     warning before doing it.
--
-- Only 0022's row is touched. Every other row was written by the application
-- through the real normalizer. The NOT EXISTS guard is for the deployment that
-- has already hand-created the duplicate: rewriting into an occupied key would
-- fail the unique index and take the whole deploy down, so that database is
-- left alone for a human to merge.
UPDATE "org_departments" AS d
   SET "name_normalized" = 'themecamps',
       "updated_at" = now()
 WHERE d."key" = 'theme_camps'
   AND d."name_normalized" <> 'themecamps'
   AND NOT EXISTS (
     SELECT 1 FROM "org_departments" o
      WHERE o."name_normalized" = 'themecamps' AND o."id" <> d."id"
   );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Take back the destruction 0022's mapping handed out.
--
-- 0022 mapped `manage_camp_categories` -> create + update + delete. The first
-- two are defensible (the right did mean CRUD over the camp-category taxonomy).
-- `delete` is not: the new `delete` is UNSCOPED BY DOMAIN — it is confined by
-- the role's DEPARTMENT, not by the one screen the old right named — and in
-- this console `delete` is wired to permanently destroying a supplier and its
-- documents, with no undo and no archive. A role that could rename a camp
-- category came out of 0022 able to destroy supplier records.
--
-- WHAT THIS CAN AND CANNOT REPAIR, stated plainly because the limit matters:
-- 0022 REBUILT the permissions object in place and this schema keeps no history
-- of it, so `{create, update, delete}` in a row today is produced identically by
-- the old `write` + `delete` (a legitimate grant) and by `manage_camp_categories`
-- alone (the over-grant). They are indistinguishable after the fact. Revoking on
-- a guess would take a right somebody deliberately gave — the same silent
-- reversal of an org decision that this migration's sibling fix to seed.ts is
-- about.
--
-- So this repairs only where the intended answer is written down in code rather
-- than inferred from data: the two SEEDED roles whose definitions say they
-- destroy nothing (@quagga/core `org-roles`).
--   · `engineer`          — "no personal information, nothing destructive", and
--                           `ENGINEER_RANK_CARVE_OUTS` refuses `delete` to that
--                           RANK regardless, so the row was advertising a power
--                           the resolver would refuse — a console that offers
--                           what it will deny.
--   · `dept.*.member`     — "A department MEMBER reads and does ordinary work,
--                           sees no personal information, and deletes nothing."
-- `org_staff` and every `dept.*.lead` are untouched: `delete` is their seeded
-- default and always was.
--
-- CUSTOM roles are deliberately left exactly as they are. They are the likeliest
-- holders of the old `manage_camp_categories` right and so the likeliest victims
-- of the mapping — and they are also the ones whose pre-0022 rights nothing
-- recorded. A System manager reviewing the roles screen is the only thing that
-- can settle those, and taking a guess here would be the more expensive error.
UPDATE "org_roles"
   SET "permissions" = "permissions" - 'delete',
       "updated_at" = now()
 WHERE "kind" = 'system'
   AND ("key" = 'engineer' OR "key" LIKE 'dept.%.member')
   AND "permissions" ? 'delete';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Somewhere for OUR rate-limit counters to live.
--
-- They were sharing Better Auth's `rate_limit` table under an `action:` key
-- prefix. Better Auth's database rate-limit storage prunes that table after a
-- window roll with `DELETE ... WHERE last_request < now - max(configured window,
-- 10s, 60s)` — every row, not only its own (better-auth 1.6.25,
-- dist/api/rate-limiter/index.mjs). Our rows keep the WINDOW START in that
-- column and never move it while the window is open, so the forgot-password
-- counter (3 per 15 minutes, shared across all three apps) was deleted roughly a
-- minute into every window by the next piece of auth traffic, and the following
-- attempt started again from 1. The configured budget behaved as 3 per minute,
-- indefinitely — enough to bury somebody's inbox in password-reset mail, which
-- is the exact abuse the limit exists to stop.
CREATE TABLE "action_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" bigint NOT NULL
);--> statement-breakpoint
CREATE INDEX "action_rate_limit_window_start_idx" ON "action_rate_limit" USING btree ("window_start");--> statement-breakpoint

-- Nothing to migrate ACROSS — a counter is worth less than the seconds it takes
-- to re-earn, and Better Auth has deleted nearly all of them already. This only
-- clears the leftovers out of a table that is not ours.
DELETE FROM "rate_limit" WHERE "key" LIKE 'action:%';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. `audit_events` gets the two indexes its readers actually use.
--
-- It is append-only and never pruned, so it is the one table in this schema that
-- only ever grows, and until now three hot console paths scanned all of it:
-- the status board's recent-activity card and the audit trail page (both
-- `ORDER BY created_at DESC LIMIT n` over the whole log), the medical access log
-- (`created_at >= <lookback>`), and POPIA erasure, which rewrites `meta`
-- `WHERE actor_id = ... OR subject = ...` and had an index for one side of that
-- OR and none for the other. DESC matches how every reader orders it.
CREATE INDEX "audit_events_subject_idx" ON "audit_events" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. A required action belongs to an EDITION.
--
-- `required_actions` was unique on (user_id, action_key). The Burner Bio gate is
-- a row with `action_key = 'burner_bio'`, and `burner_bios` has always been
-- per-edition because contact numbers, emergency contacts and medical notes go
-- stale in a year and the point of holding them is that they are true when
-- somebody is in the desert.
--
-- With no edition in the key there could only ever be ONE burner_bio row per
-- person, for life. Completed in 2027, still completed in 2028, and
-- `ensureRequiredAction`'s ON CONFLICT DO NOTHING quietly discarding the new
-- edition's row. The gate would have fired once per burner ever: the 2028
-- onboarding simply never appears, no error anywhere, and every 2027 phone
-- number is treated as current. Ryan, 28 Jul 2026 — the bio PERSISTS across
-- editions but must be UPDATED once per edition, so the gate must fire again.
--
-- Backfill: an action that came from a questionnaire activation takes that
-- activation's edition (the honest answer — it is the edition the questionnaire
-- was sent for); everything else takes the active edition, which for existing
-- rows is the only edition they can have been raised under. The column is then
-- made NOT NULL. On a database with required actions and NO editions at all that
-- ALTER fails and the deploy stops — which is correct: that database is broken
-- in a way this migration must not paper over by deleting people's gates.
ALTER TABLE "required_actions" ADD COLUMN "edition_id" uuid;--> statement-breakpoint
UPDATE "required_actions" AS ra
   SET "edition_id" = COALESCE(
     (SELECT a."edition_id" FROM "questionnaire_activations" a
       WHERE a."id" = ra."activation_id"),
     (SELECT e."id" FROM "editions" e
       ORDER BY e."is_active" DESC, e."year" DESC LIMIT 1)
   )
 WHERE ra."edition_id" IS NULL;--> statement-breakpoint
ALTER TABLE "required_actions" ALTER COLUMN "edition_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "required_actions" ADD CONSTRAINT "required_actions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "required_actions_user_action_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "required_actions_user_edition_action_idx" ON "required_actions" USING btree ("user_id","edition_id","action_key");
