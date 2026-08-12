-- Make the registration deadline reminder's idempotency real rather than hoped
-- for (review on PR #26).
--
-- THE JOB CHECKED, THEN WROTE. It read `audit_events` for its marker, and if it
-- was absent, went on to insert the notifications and the marker in a
-- transaction. Two concurrent invocations both pass that check — cron delivery
-- is at-least-once and a retry after a partial failure is a normal Tuesday — so
-- both proceed, and every camp lead is told twice that they have seven days
-- left. A reminder channel that repeats itself is a channel people mute.
--
-- Nothing enforced uniqueness, so the second writer had nothing to collide with.
-- This index gives it something: the job now CLAIMS the marker with a
-- conflict-safe insert as the first statement in its transaction, and a claim
-- that returns no row means someone else is already sending. The check and the
-- claim become the same operation, which is the only way this is actually safe.
--
-- PARTIAL, scoped to the one action. `audit_events` is the append-only record of
-- everything the console does — approvals, role edits, placement assignments —
-- and those are deliberately NOT unique on (action, subject): a camp can be
-- approved, reopened and approved again, and every one of those rows must
-- survive. Constraining the whole table would rewrite that contract to fix one
-- job. The `WHERE` clause keeps the guarantee exactly as wide as the problem.
CREATE UNIQUE INDEX IF NOT EXISTS "audit_events_deadline_reminder_marker_idx"
  ON "audit_events" ("action", "subject")
  WHERE "action" = 'registration.deadline_reminder';
