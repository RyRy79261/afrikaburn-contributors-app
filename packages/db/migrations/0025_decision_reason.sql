-- The camp never saw why it was rejected.
--
-- `applyReviewDecision` REQUIRES a reason for a rejection ("A rejection needs a
-- reason for the camp.") and then writes it to exactly two places: the audit
-- event's `meta.reason`, which no participant surface reads, and the decision
-- notification's body. Meanwhile the camp's own registration page renders
-- "Not approved — See the reviewer's notes below", and "below" is the
-- per-section feedback thread (`section_reviews`) — a different table, written
-- by a different action, which a reviewer who simply rejected never touched.
--
-- So the common path is: reviewer types a mandatory explanation, camp opens
-- their registration, reads a banner pointing at an empty thread, and has to go
-- hunting in a notification to learn why their year is over. The reason exists;
-- it just was not on the row the page reads.
--
-- Nullable, because it is only ever set by a decision, and `changes_requested`
-- (which also demands a reason) shares it — that state's whole point is telling
-- the camp what to fix.
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "decision_reason" text;

-- Backfill from the audit trail, which has carried `meta.reason` since the
-- action was written. The latest reason-bearing decision per registration wins,
-- so a camp that was asked for changes and then rejected sees the rejection.
UPDATE "registrations" AS r
SET "decision_reason" = latest.reason
FROM (
  SELECT DISTINCT ON (a."subject")
    a."subject" AS registration_id,
    a."meta" ->> 'reason' AS reason
  FROM "audit_events" AS a
  WHERE a."action" IN (
      'registration.reject',
      'registration.request_changes'
    )
    AND a."meta" ->> 'reason' IS NOT NULL
  ORDER BY a."subject", a."created_at" DESC
) AS latest
WHERE r."id"::text = latest.registration_id
  AND r."decision_reason" IS NULL;
