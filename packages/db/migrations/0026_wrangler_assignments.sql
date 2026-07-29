-- Wrangler assignments (roadmap M4-01; discovery question #61).
--
-- A wrangler is AfrikaBurn's "dusty guardian angel" for a registered theme camp
-- — an org member from the theme-camp leads team who shepherds one camp through
-- build week and check-in (docs/synthesis.md, docs/mvp-proposal.md).
--
-- Until now the concept existed in three places and nowhere else: the `wrangler`
-- notification kind (migration 0009), a pre-written `wranglerAssignedNotification`
-- builder in @quagga/core that nothing called, and a permanently DISABLED
-- "Assign wrangler" button on the org review screen whose copy promised it
-- "unlocks after approval". It never unlocked, because there was nothing behind
-- it. The Overview's Wranglers tile was at least honest and said so.
--
-- ## The shape, and why
--
-- PER EDITION, like everything else that is a fact about one burn. A wrangler
-- relationship is not a property of the camp; it is a property of the camp IN A
-- GIVEN YEAR, and carrying it across a rollover would silently re-assign a
-- volunteer to a camp they never agreed to shepherd again — the same mistake
-- migration 0023 fixed for officer consent.
--
-- ONE WRANGLER PER CAMP PER EDITION (the unique index). AfrikaBurn's own words
-- are singular — "assigned a Theme Camp Wrangler", "is now your wrangler" — and
-- a camp with two guardian angels has none, because neither owns the follow-up.
-- A wrangler holds MANY camps; that direction is the board.
--
-- REASSIGNMENT REPLACES, and the history lives in `audit_events`. This codebase
-- already treats the audit log as the record of who-changed-what (every
-- registration decision, every role edit), so a second history table here would
-- be a second answer to a question that already has one.
--
-- NO MILESTONE COLUMNS. The roadmap sketches "+ milestone state", and the
-- wrangler board wants per-camp progress — but every milestone worth showing
-- today is already derivable (registration status, questionnaire completion,
-- supplier declarations). Storing a copy would mean inventing values nobody
-- sets and then rendering them as fact, which is the one thing this console has
-- consistently refused to do. When real milestones exist, they get their own
-- table and this one is untouched.
CREATE TABLE IF NOT EXISTS "wrangler_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "edition_id" uuid NOT NULL,
  -- The org member doing the wrangling. `set null` rather than cascade: losing
  -- the account must not silently delete the record that this camp HAD a
  -- wrangler — the board needs to show it as vacant, not as never-assigned.
  "wrangler_user_id" uuid,
  -- Who assigned them, for the audit trail's benefit. Nullable for the same
  -- reason `audit_events.actor_id` is.
  "assigned_by_user_id" uuid,
  "assigned_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wrangler_assignments_group_id_groups_id_fk'
  ) THEN
    ALTER TABLE "wrangler_assignments"
      ADD CONSTRAINT "wrangler_assignments_group_id_groups_id_fk"
      FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wrangler_assignments_edition_id_editions_id_fk'
  ) THEN
    ALTER TABLE "wrangler_assignments"
      ADD CONSTRAINT "wrangler_assignments_edition_id_editions_id_fk"
      FOREIGN KEY ("edition_id") REFERENCES "editions"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wrangler_assignments_wrangler_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "wrangler_assignments"
      ADD CONSTRAINT "wrangler_assignments_wrangler_user_id_users_id_fk"
      FOREIGN KEY ("wrangler_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wrangler_assignments_assigned_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "wrangler_assignments"
      ADD CONSTRAINT "wrangler_assignments_assigned_by_user_id_users_id_fk"
      FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

-- ONE PER CAMP PER EDITION. Enforced here rather than in the action alone: two
-- reviewers assigning different wranglers in the same second is exactly the race
-- the console's own TOCTOU guard exists for elsewhere, and a duplicate here
-- would make "who is my wrangler?" unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS "wrangler_assignments_group_edition_idx"
  ON "wrangler_assignments" ("group_id", "edition_id");
--> statement-breakpoint

-- The board's read: "every camp this wrangler holds, this edition".
CREATE INDEX IF NOT EXISTS "wrangler_assignments_wrangler_edition_idx"
  ON "wrangler_assignments" ("wrangler_user_id", "edition_id");
