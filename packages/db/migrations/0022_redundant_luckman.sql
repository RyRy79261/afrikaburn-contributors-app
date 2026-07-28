-- Org permissions become CRUD per department (audit + Ryan, 28 Jul 2026).
--
-- "There should just be CRUD operations per department, not scope to individual
-- actions, a feature can either check if you have deletion rights, or if you are
-- an admin." And: "PII should be a specific permission scoped to the relevant
-- department or context."
--
-- The vocabulary was `read · read_personal_information · write · delete ·
-- manage_camp_categories · manage_accounts · read_system`. It had drifted into
-- per-feature rights — `manage_camp_categories` existed for one screen — and
-- `delete` was department-scoped while being wired to exactly two actions, both
-- supplier ones, so every department's rights screen described deleting
-- suppliers whatever the department was.
--
-- The new vocabulary is `create · read · update · delete · personal_information`,
-- all five department-scoped. Administering the deployment is the System manager
-- RANK and the system panel is the engineer/System manager RANK, so neither is a
-- grant any more and neither can be written into a row.
--
-- MAPPING, and what is deliberately lost:
--   read                      -> read
--   write                     -> create + update   (one right became two; a role
--                                that could amend could also add, and now those
--                                are separable — nobody LOSES access here)
--   delete                    -> delete
--   read_personal_information -> personal_information
--   manage_camp_categories    -> create + update + delete   (it only ever meant
--                                CRUD on one domain; now it says so)
--   manage_accounts           -> DROPPED. System-manager-only already, and
--                                unreachable as a grant, so no role loses a
--                                power it could actually exercise.
--   read_system               -> DROPPED. Now the engineer/System manager rank
--                                (`runsDeployment`), which is who held it.
--
-- Written as a jsonb rebuild rather than key renames so a row carrying a key
-- from neither vocabulary cannot survive: the result is exactly the five keys,
-- or absent.

CREATE TYPE "public"."org_department_kind" AS ENUM('system', 'custom');--> statement-breakpoint
ALTER TABLE "org_departments" ADD COLUMN "kind" "org_department_kind" DEFAULT 'custom' NOT NULL;--> statement-breakpoint

-- Rebuild every stored permissions object into the new five-key vocabulary.
UPDATE "org_roles"
   SET "permissions" = (
     SELECT COALESCE(jsonb_object_agg(k, true), '{}'::jsonb)
       FROM (
         SELECT 'read' AS k WHERE "permissions" ->> 'read' = 'true'
         UNION ALL
         SELECT 'create' WHERE "permissions" ->> 'write' = 'true'
                            OR "permissions" ->> 'manage_camp_categories' = 'true'
         UNION ALL
         SELECT 'update' WHERE "permissions" ->> 'write' = 'true'
                            OR "permissions" ->> 'manage_camp_categories' = 'true'
         UNION ALL
         SELECT 'delete' WHERE "permissions" ->> 'delete' = 'true'
                            OR "permissions" ->> 'manage_camp_categories' = 'true'
         UNION ALL
         SELECT 'personal_information'
           WHERE "permissions" ->> 'read_personal_information' = 'true'
       ) AS mapped
   )
 WHERE "permissions" IS NOT NULL;--> statement-breakpoint

-- The two departments that back a deployed portal. Seeded here rather than only
-- in seed.ts because an EXISTING database has already run the seed and would
-- otherwise never get them — which is the state Ryan hit: hand-creating the two
-- departments that should never have been optional.
--
-- ON CONFLICT DO NOTHING on the stable key: a deployment that already
-- hand-created "Theme Camps" or "Suppliers" keeps its row (and its assignments),
-- and only has its kind promoted below.
INSERT INTO "org_departments" ("key", "name", "name_normalized", "description", "kind", "sort")
VALUES
  ('theme_camps', 'Theme camps', 'theme camps',
   'Camp, artwork and vehicle registrations — the review pipeline behind the participant app.',
   'system', 0),
  ('suppliers', 'Suppliers', 'suppliers',
   'The supplier repository and the documents suppliers acknowledge — the org side of the supplier portal.',
   'system', 1)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Promote a hand-created equivalent to `system` so it stops being deletable.
UPDATE "org_departments" SET "kind" = 'system'
 WHERE "key" IN ('theme_camps', 'suppliers');--> statement-breakpoint

-- Give each its domains, if nothing owns them yet. A deployment that has already
-- filed these domains under a different department is LEFT ALONE: someone made
-- that choice deliberately and a migration must not overrule it.
INSERT INTO "org_department_domains" ("domain", "department_id")
SELECT d.domain, dept.id
  FROM (VALUES
          ('registrations', 'theme_camps'),
          ('camp_categories', 'theme_camps'),
          ('suppliers', 'suppliers'),
          ('supplier_documents', 'suppliers')
       ) AS d(domain, dept_key)
  JOIN "org_departments" dept ON dept."key" = d.dept_key
ON CONFLICT ("domain") DO NOTHING;
