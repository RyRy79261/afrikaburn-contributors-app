-- Answering a questionnaire ON BEHALF OF A CAMP (roadmap M4-20, Form 2).
--
-- Form 2 asks camp-level questions — how big are you, where do you want to be,
-- what noise will you make, and the layout diagram. `questionnaire_responses`
-- had no camp dimension: it is unique on (user_id, definition_key, edition_id),
-- one answer per PERSON per form per edition.
--
-- A person may lead more than one approved camp. `buildDeletionGuardContext`
-- already treats "camps this person leads" as a list, so this is a state the
-- model reaches today, not a hypothetical. Without a camp dimension that lead
-- gets ONE Form-2 response for TWO camps, and there is no honest way to mirror
-- one declared camp size onto two registrations. Whichever camp we picked would
-- be a guess, and the other camp's answers would be silently wrong on a form
-- AfrikaBurn uses to place people.
--
-- `group_id` is NULLABLE and stays null for every questionnaire that really is
-- about a person — the Burner Bio spine, the org's internal check-ins. Nothing
-- is backfilled, because nothing existing is camp-scoped.
--
-- CASCADE on delete: a camp's Form-2 answers are facts about that camp. When the
-- camp goes they go with it; keeping them would leave orphaned declarations of
-- size and sound belonging to nothing.
ALTER TABLE "questionnaire_responses"
  ADD COLUMN IF NOT EXISTS "group_id" uuid;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questionnaire_responses_group_id_groups_id_fk'
  ) THEN
    ALTER TABLE "questionnaire_responses"
      ADD CONSTRAINT "questionnaire_responses_group_id_groups_id_fk"
      FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint

-- TWO PARTIAL UNIQUE INDEXES, NOT ONE WIDENED ONE. This is the whole risk of
-- this migration and it is worth stating plainly.
--
-- The obvious move is to widen the existing index to include `group_id`. It
-- would have been a live data-integrity bug: Postgres treats NULLs as DISTINCT
-- in a unique index by default, so `(user, definition, edition, NULL)` no longer
-- collides with itself and EVERY per-person questionnaire — the Burner Bio
-- included — would accept unlimited duplicate rows per user. The one-answer-per-
-- person guarantee would have been dropped by a migration whose stated purpose
-- was adding a column.
--
-- `NULLS NOT DISTINCT` (Postgres 15+) would also fix it, but partial indexes say
-- the intent out loud and work on any version: person-scoped answers are unique
-- per person, camp-scoped answers are unique per person AND camp.
DROP INDEX IF EXISTS "questionnaire_responses_user_def_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "questionnaire_responses_user_def_idx"
  ON "questionnaire_responses" ("user_id", "definition_key", "edition_id")
  WHERE "group_id" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "questionnaire_responses_user_def_group_idx"
  ON "questionnaire_responses" ("user_id", "definition_key", "edition_id", "group_id")
  WHERE "group_id" IS NOT NULL;
--> statement-breakpoint

-- The read the org's Form-2 chase list makes: "which approved camps have
-- returned this form?"
CREATE INDEX IF NOT EXISTS "questionnaire_responses_group_idx"
  ON "questionnaire_responses" ("group_id", "definition_key");
