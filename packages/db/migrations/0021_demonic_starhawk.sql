-- Notification provenance + link destination (audit M13).
--
-- One `notifications` table is read by all three apps, and a row's `link` was a
-- bare app-relative path with nothing saying which app it belonged to. A
-- supplier bulletin linking to /bulletins/<id> 404'd because that route did not
-- exist in the suppliers app.
--
-- `origin` answers "who sent this" (org / camp / system) — the scope Ryan asked
-- for, so "AfrikaBurn asked you" and "your camp lead asked you" are
-- distinguishable in the inbox.
--
-- `link_app` answers the different question "where does this link resolve"
-- (web / org / suppliers). They are not the same axis: the org console writes
-- the supplier inbox, so those rows have origin=org and link_app=suppliers.
--
-- BOTH NULLABLE, deliberately. All three apps migrate at build time, so
-- whichever deploys first would be writing columns the other two do not yet
-- bind — and every notification insert swallows its own exception, making that
-- failure silent. Null means "unknown, treat as local", i.e. exactly the
-- behaviour before this migration.

ALTER TABLE "notifications" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link_app" text;