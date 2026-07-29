-- Officer consent is consent for ONE edition.
--
-- `member_role_assignments` had no edition, `memberships` has none, and nothing
-- resets assignments at rollover. So an officer who accepted in one burn stayed
-- `consent_status = 'accepted'` and `org_visible = true` for every burn after
-- it — while the org console reads the CURRENT edition's bio (it joins
-- `burner_bios` on the active edition). The result is this year's phone number
-- disclosed to AfrikaBurn on last year's consent, for a burn the person may not
-- be attending. Officer consent is the single POPIA disclosure channel in this
-- product; it must expire with the edition it was given for.
--
-- Nullable on purpose. Only officer rows carry a disclosure — an ordinary role
-- chip ("Bar crew") is a camp label and legitimately persists across editions.
ALTER TABLE "member_role_assignments"
  ADD COLUMN IF NOT EXISTS "consent_edition_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_role_assignments_consent_edition_id_editions_id_fk'
  ) THEN
    ALTER TABLE "member_role_assignments"
      ADD CONSTRAINT "member_role_assignments_consent_edition_id_editions_id_fk"
      FOREIGN KEY ("consent_edition_id") REFERENCES "editions"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- BACKFILL to the active edition, and only for rows that actually carry a
-- consent. There has only ever been one edition, so every existing acceptance
-- was given for it — nobody is asked to re-consent for a burn already under way.
-- Rows with no active edition to point at stay NULL and read as "no consent for
-- this edition", which is the fail-closed answer.
UPDATE "member_role_assignments" mra
SET "consent_edition_id" = e."id"
FROM "editions" e
WHERE e."is_active" = true
  AND mra."consent_edition_id" IS NULL
  AND mra."consent_status" = 'accepted';

CREATE INDEX IF NOT EXISTS "member_role_assignments_consent_edition_idx"
  ON "member_role_assignments" ("consent_edition_id");
