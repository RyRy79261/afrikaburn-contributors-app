-- Scope questionnaire answers to an AfrikaBurn edition (audit M12).
--
-- Answers were identified by (user_id, definition_key) FOREVER. Org
-- questionnaire keys are stable across years (`org-<title-slug>`), so answering
-- the same questionnaire in a later edition silently overwrote the earlier
-- year's answer in place. The rule (Ryan, 27 Jul 2026): re-sending WITHIN an
-- edition keeps updating the one living answer; a new edition is a fresh
-- namespace.
--
-- HAND-EDITED from the generated version, which did `ADD COLUMN ... NOT NULL`
-- in one statement and would abort on any existing row. The column lands
-- nullable, is backfilled, and only then becomes NOT NULL.
--
-- The backfill REFUSES TO GUESS. Rows reachable from their activation take that
-- activation's edition. Anything left over (MV/art registration answers, which
-- carry no activation, and pre-feature activations whose edition_id is null) can
-- only be resolved when the database has exactly one edition — which is the
-- current state. With more than one, the migration raises rather than silently
-- filing someone's answers under the wrong year.

DROP INDEX "questionnaire_responses_user_def_idx";--> statement-breakpoint

ALTER TABLE "questionnaire_responses" ADD COLUMN "edition_id" uuid;--> statement-breakpoint

-- Pass A — unambiguous: the answer's own activation knows its edition.
UPDATE "questionnaire_responses" r
   SET "edition_id" = a."edition_id"
  FROM "questionnaire_activations" a
 WHERE r."activation_id" = a."id"
   AND a."edition_id" IS NOT NULL
   AND r."edition_id" IS NULL;--> statement-breakpoint

-- Pass B — everything else, only when there is one possible answer.
DO $$
DECLARE
  remaining bigint;
  edition_count bigint;
  only_edition uuid;
BEGIN
  SELECT count(*) INTO remaining
    FROM "questionnaire_responses" WHERE "edition_id" IS NULL;
  IF remaining = 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO edition_count FROM "editions";
  IF edition_count <> 1 THEN
    RAISE EXCEPTION
      'Cannot backfill questionnaire_responses.edition_id: % row(s) have no activation to derive an edition from, and there are % editions to choose between. Resolve these rows by hand, then re-run.',
      remaining, edition_count;
  END IF;

  SELECT "id" INTO only_edition FROM "editions";
  UPDATE "questionnaire_responses"
     SET "edition_id" = only_edition
   WHERE "edition_id" IS NULL;
END $$;--> statement-breakpoint

ALTER TABLE "questionnaire_responses" ALTER COLUMN "edition_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "questionnaire_responses_user_def_idx" ON "questionnaire_responses" USING btree ("user_id","definition_key","edition_id");
