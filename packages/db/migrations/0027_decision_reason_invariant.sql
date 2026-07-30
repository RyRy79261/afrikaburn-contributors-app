-- Fixing what migration 0025's backfill got wrong, on live data.
--
-- 0025 added `registrations.decision_reason` and backfilled it from the audit
-- trail, taking the latest reason-bearing decision per registration. It filtered
-- on the AUDIT ACTION (`registration.reject`, `registration.request_changes`) and
-- on nothing else — in particular not on the registration's CURRENT status.
--
-- So a camp that was asked for changes, fixed them, resubmitted and was APPROVED
-- had that old change-request written into `decision_reason`. The camp's own
-- registration page then rendered, inside the green banner:
--
--     Approved — you're registered
--     From the reviewer: your Leave No Trace section needs more detail
--
-- Which is a sentence AfrikaBurn is no longer saying, presented as if they were.
-- The same applied to a withdrawn registration, and to one resubmitted and
-- awaiting review.
--
-- THE INVARIANT, stated once: `decision_reason` holds the reviewer's words for
-- the CURRENT state, and only two states carry any — `rejected` and
-- `changes_requested`. Everything else must be null. The forward path already
-- honours this (`decideRegistration` sets `decisionReason: reason ? reason :
-- null` on every transition, so an approval clears it) — the backfill wrote
-- history the forward path would never have produced.
--
-- 0025 cannot be edited: it is append-only and has already applied. This
-- corrects the data instead, and it is idempotent — on a deployment where the
-- backfill matched nothing it updates zero rows.
UPDATE "registrations"
SET "decision_reason" = NULL
WHERE "decision_reason" IS NOT NULL
  AND "status" NOT IN ('rejected', 'changes_requested');
