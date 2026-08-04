# Build Spec — the engineering contract

The engineering contract. Where any other document conflicts with it, this
file wins; where this file and `AGENTS.md` conflict, this one wins for engineering and
`AGENTS.md` wins for process. Camp 404 (github.com/ryry79261/camp-404) is the
conventional reference — workspace layout, drizzle patterns, Zod-at-boundaries.

## Hard constraints

1. **Migrations are generated offline, committed append-only, and applied by the
   build at deploy time.** _(Corrected 27 Jul 2026. This constraint used to read "no
   migration step in the build", which was true only while no database existed. Now
   that one does, deploy-time migration is the law — see AGENTS.md §1, the fuller
   statement.)_ `db:generate` produces the file offline from `schema.ts`; every app's
   `build` then runs `db:migrate:deploy` before `next build`. That runner takes a
   Postgres session advisory lock on the **unpooled** connection (`DATABASE_URL_UNPOOLED`)
   so three concurrent Vercel builds serialise, and it **aborts rather than falling
   back to a pooled URL** — session advisory locks do not hold on PgBouncer. It also
   **bootstraps reference data when `editions` is empty**, so a fresh database comes up
   usable; it is a bootstrap, not a sync, and never re-asserts rows over an organiser's
   edits. A migration is never hand-edited, never regenerated, and never applied by a
   person against production.
2. Package namespace **`@quagga/`**. Node ≥ 22, pnpm 10, Turborepo.
3. Stack: Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, Drizzle + Neon (HTTP driver in handlers, pooled for scripts), **self-hosted Better Auth 1.6.25** mounted per app from `@quagga/auth` at `/api/auth/[...all]` (managed Neon Auth was removed — migration 0013), Resend for email, Vercel Blob for uploads.
4. Apps must **boot without env/DB** to a landing page (graceful "not configured" state); DB-backed routes may error clearly but must not crash the build.
5. Schema below is **frozen** — feature agents do not add/alter tables. `packages/db/src/schema.ts` is the single source of truth; migrations are generated, append-only, never hand-edited.
6. TypeScript strict; Zod validation at every boundary; no `any` in committed code. Vitest for core logic. CI gate: `pnpm turbo run lint typecheck test build`.
   6b. **Prefer prebuilt components over hand-rolling (Ryan, 24 Jul 2026).** For any solved UI problem (phone inputs, date pickers, comboboxes, OTP fields…), use an existing package — preferably from the shadcn ecosystem/registry — and restyle it to our tokens. Hand-rolling complex, already-solved components is a defect. Bio field spec: years-attended is a multi-select of specific years (2007–2026, 2020/21 disabled "no burn"); phone uses an international phone input with country selector; emergency contacts are TWO (on-site + off-site), each with separate name and number fields, all hard-locked private.
7. UI: **"Tankwa Night" hybrid, approved 23 Jul 2026 — brand colours sampled from afrikaburn.org Elementor kit.** Dark-mode-first app shell dressed in AfrikaBurn's real brand colours; light supported via a `.light` class on `<html>`.
   - **Brand ramp** (raw, usable directly as e.g. `text-ab-teal`): teal `#2D7696`, teal-deep `#235C75`, apricot `#F4B672`, peach `#FFBC7D`, sage `#B6D090`, olive `#7D9953`, charcoal `#333333`, warm white `#FFFAF2`.
   - **Dark semantic tokens (default):** background `#17191B`, foreground `#F4F0E8`, card/popover `#1F2326`, muted `#262B2F`, muted-foreground `#ADB6B3`, border/input `#323A3F`, primary `#2D7696` (fg `#F4F0E8`), secondary `#26333B` (fg `#DCE8ED`), accent `#F4B672` (fg `#17191B`), ring `#2D7696`, destructive `#C24438` (fg `#F4F0E8`), success `#B6D090` (fg `#17191B`), warning `#F4B672` (fg `#17191B`). `--radius` `0.5rem`.
   - **Light (`.light`):** background `#FFFAF2`, foreground `#333333`, card/popover `#FFFFFF`, muted `#F1E9DB`, muted-foreground `#6E6558`, border/input `#E5DBC9`, primary `#2D7696` (fg `#FFFAF2`), secondary `#EAF0F3` (fg `#235C75`), accent `#F4B672` (fg `#333333`), ring `#2D7696`, destructive `#B23A2E`, success `#7D9953` (fg `#1F2A12`), warning `#D98A2B` (fg `#332006`) — dark foregrounds on the mid-tone fills because white text fails WCAG AA on them.
   - **`.org-accent` skin** (org app applies it on `<html>` alongside the theme): primary → `#F4B672` (fg `#17191B`), ring → `#F4B672`; in `.light.org-accent` primary → `#D98A2B` (fg `#332006`, dark for AA) — so the console's interactive colour is apricot, the participant app's teal.
   - **Status mapping:** approved → success (sage), changes_requested → warning (apricot), rejected → destructive, submitted/under_review → primary (teal), draft → muted/outline.
   - **Typography:** Montserrat via `next/font/google` (weights 500/600/700/800, `--font-brand`, display swap). Body 500; `@layer base` treats `h1,h2` as 800 UPPERCASE (`letter-spacing 0.01em`) and `h3` as 700.
   - **Identity motif:** `QuiltBand` — a repeating band of brand-triad diamonds on each app-shell header top edge, spanning the **full page width edge-to-edge** (Ryan, 24 Jul 2026), plus landing/auth dividers. **The real AfrikaBurn logo and San-hand emblem are approved for use** (assets in `design/brand/`): nav carries the 282×40 wordmark banner; favicons may adopt the emblem (current original diamond favicons remain until swapped). Photography of identifiable people stays forbidden.
   - Non-corporate, warm, no lorem ipsum anywhere — realistic copy.

## Monorepo layout

```
apps/
  web/        participant app   (port 3000, teal)
  org/        org/admin console (port 3001, apricot) — separate deployment, own auth gate
  suppliers/  supplier portal   (port 3002, sage)   — separate deployment
packages/
  auth/   self-hosted Better Auth config, mounted by all three apps (@quagga/auth)
  ui/     shared shadcn components + tailwind tokens (@quagga/ui)
  db/     drizzle schema + append-only migrations + the deploy migrator (@quagga/db)
  core/   shared domain logic + every authz predicate (@quagga/core)
  types/  zod schemas + shared types (@quagga/types)
  eslint-config/  typescript-config/
e2e/      Playwright persona suite (@quagga/e2e) — run by `pnpm e2e:local`, never by the unit gate
```

**Local stack.** `docker-compose.local.yml` runs Postgres 16 plus _two_ Neon proxies
(SQL-over-HTTP and WebSocket) because `@neondatabase/serverless` uses both protocols
and no single proxy implements them. `NEON_LOCAL_PROXY=1` points both drivers at it.
`pnpm e2e:local` brings that up from cold, migrates, seeds, boots all three apps and
runs the persona suite.

## Environment variables (`.env.example` at root; all optional for boot)

`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET` (self-hosted Better
Auth — identical on all three apps), `BETTER_AUTH_URL` (per app),
`BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION` (optional override),
`AUTH_RATE_LIMIT_WINDOW_SECONDS` / `AUTH_RATE_LIMIT_MAX` (optional — RAISE the limiter's
ceiling for a test deployment; leave unset in production), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `GOD_EMAILS` (comma list — grants god on
first login to a VERIFIED address), `BLOB_READ_WRITE_TOKEN`, `PGCRYPTO_KEY`. Update
turbo.json `globalEnv` in the same change (Camp 404 rule). **The org console's `/system`
page reports the resolved state of every one of these** — set or unset, and what follows —
without ever printing a value.

## Schema (frozen)

- `users` — auth join (`auth_user_id`), email, created_at, `sanitized_at` tombstone,
  and **`username`** (migration 0016). Minimal; no role columns.
  **The username is the burner's one public handle** — account-level, **optional**,
  3–20 chars, unique on `lower(username)`. It deliberately does NOT live on
  `burner_bios.display_name`: bios are per-edition, so a handle there would let one
  person hold a different name every year and "unique" would mean nothing. It is an
  **alias, not an identity anchor** (Ryan, 27 Jul 2026: _"the playa name is kinda
  cringe… its optional and should be treated like an alias, not a root identity"_).
  All rules live once in `@quagga/core` `username.ts` — charset, the reserved list
  (nobody may take `admin`/`afrikaburn` or shadow a route segment), and the neutral
  `UNNAMED_BURNER` fallback, which is **never** a legal name and **never** an email
  (both are private by default; either as a fallback would be a privacy incident).
  Consequently **`isBioComplete` keys on `burner_bios.completed_at`** — the burner
  reached the end of the flow and saved — not on any name. Completion is an act, not
  a filled field; nothing inside the bio is mandatory. _(Marked PROVISIONAL at its
  definition: the alternative, if a real anchor is ever wanted, is the legal name,
  since the ID/passport exist to match a person to their ticket. Do not invent a
  third field.)_
- `burner_bios` — user × edition. Field set mirrored from Camp 404's burner profile (read its schema.ts) + `privacy_flags` jsonb (per-field public/private). **Always-private fields** (`id_number`, `passport_number`, phone, emergency contact, medical): enforced in `@quagga/core` — flags for these cannot be set public, ever. pgcrypto-encrypt id/passport **and medical** columns. Two classes (see AGENTS.md §Privacy classes + `docs/accounts-security-spec.md`): the first four are _hard-locked_ with no access path; **medical is _safety-visible_** — never public, but visible to the burner's own camp leads and org staff on a member DETAIL view (consented at entry via the field's label, audited on read, never in lists or exports).
- `profile_keys` — user_id, public_key, encrypted_private_key, created_at. Generated server-side at onboarding; used for nothing yet except future QR attestations.
- `groups` — kind enum (`org|theme_camp|artwork|mutant_vehicle`), name, `name_normalized` (unique per kind, case/space/punct-insensitive), description (60-word limit for camps), joinability enum (`open|invite_only`), `visibility` reserved column (default `default`), created_by. Exactly one seeded `org` row ("AfrikaBurn").
- `memberships` — user × group, role enum (`god|org_staff|lead|admin|member|engineer`), unique(user, group). The three ORG ranks (`god|org_staff|engineer`) are only valid on the org group, and on it the enum is **the console DOOR, not the rights** (see apps/org routes). **`god` is presented throughout the UI as "System manager"** — the stored value stays `god` deliberately (renaming it would migrate live rows and re-cut the GOD_EMAILS bootstrap for a label) — and is the anti-lockout ANCHOR. _(Migration 0017's free-text `department` label + `department_lead` flag were DROPPED by 0018: departments are rows now, and two department vocabularies would be the parallel source of truth org roles v1 exists to remove.)_
- `org_departments` — org departments as DATA (0018): `key` (stable slug), name, normalized name, description, sort. Created by a System manager; creating one seeds its permanent LEAD + MEMBER roles, deleting one cascades them away.
- `org_roles` — the org mirror of `project_roles` (0018): `key`, nullable `department_id` (cascade), name + normalized name, `kind` (`system` = seeded/undeletable/rights-editable, `custom` = fully the System manager's), curated `color`, `permissions` jsonb over the org capability vocabulary, sort. Unique on `key` and on normalized name.
- `org_role_assignments` — membership × role, composite PK (0018), mirroring `member_role_assignments`. Cascades off the membership, so removing console access releases every role with it.
- `invites` — group_id, token, kind (`member|lead_transfer`), created_by, expires_at, used_by, used_at. One-time.
- `editions` — name, year, start_date, end_date, is_active. Seed: **AfrikaBurn 2027, 2027-04-26 → 2027-05-02, active**.
- `registrations` — group × edition, status enum (`draft|submitted|under_review|changes_requested|approved|rejected|withdrawn`), plus typed columns for the six sections per Finlay's field list in `docs/sources/scope-theme-camp-registration.txt` (identity/contact, LNT incl. lead contact, participation & gifting, size & logistics incl. layout upload URLs (max 4), sound & placement prefs, suppliers & commerce), `submitted_at`, `decided_at`. **A camp is "registered" for an edition iff an approved registration row exists** — that predicate lives in `@quagga/core` (`isRegistered`), and entitlements derive from it.
- `section_reviews` — registration_id, section key enum (six values), status (`open|resolved`), comment, reviewer_id.
- `questionnaire_definitions`, `questionnaire_responses`, `questionnaire_activations`, `required_actions` — ported 1:1 from Camp 404's pattern (keys map to code-side registry; Burner Bio dispatches through this).
- `suppliers` — name, `code` (`SUP-2027-0416`, stored not derived), services, contact,
  website, category, `returning`, `standing` enum (`good|watch|suspended`), optional
  `user_id` account link, imported_at. _(`vetting_status` and `source` were killed per
  `docs/supplier-spec.md` and no longer exist — do not reintroduce them.)_
- `supplier_declarations` — registration_id × supplier_id, note.
- `payments` — subject_type + subject_id (polymorphic by string key), amount_cents nullable, currency default ZAR, reference (human-readable, e.g. `QP-2027-MAH-001`), status enum (`pending|reconciled|waived`), details jsonb, recorded_by. **No processing, ever.**
- `audit_events` — actor_id, action, subject, meta jsonb. Written on: elevation, approval/rejection, payment reconciliation.

## apps/web routes

`/` landing (works env-less) · `/auth/*` (our own branded Better Auth screens —
sign-in/up, forgot + reset password, verify) · `/account`, `/account/security`
(2FA enrolment, passkeys, sessions, security events), `/account/delete` ·
`/onboarding` Burner Bio
(questionnaire runner; gates the rest via `required_actions`) · `/directory` (registered
camps public; joinability badge; search) · `/camps/new` (create → instant free camp;
name dedupe: reject exact-normalized match, warn on trigram similarity ≥ 0.55) ·
`/camps/[slug]` dashboard (members, invite management for leads, registration status
tile, **disabled hint tiles**: Containers "separate app — for large camps" · Water/Ice/Gas
"pending AfrikaBurn input" · Placement & Art grants "entitlement — process TBC" · Shifts/
Budget/Layout "topics under exploration") · `/camps/[slug]/registration` (six-section
wizard: any order, autosave drafts, 60-word counter, Blob layout uploads, supplier
picker from repository, submit enabled only when all six sections complete; post-submit:
status + per-section feedback + resubmit) · `/profile` (bio edit, privacy toggles,
key fingerprint display).

## apps/org routes

Auth gate: only an ORG RANK (god / org_staff / engineer) may enter; everyone else sees a
polite wall. **Clearing that gate is the DOOR, not the rights** (org roles v1, migration
0018 — Ryan, 27 Jul 2026: _"system admins can simply have a roles management section and
create n sign these things instead of needing to hardcode them? With some set permanent
ones, like team leads and team members for each department domain, these cant be removed
but they can have the rights edited"_).

What an account may do is the union of the ORG ROLES assigned to it, resolved by the ONE
resolver in `@quagga/core` `org-permissions` (`orgCan` / `orgCanIn`), which both the gate
and the UI read so a hidden control and a refused action can never disagree. The model
deliberately MIRRORS camp Roles v2 — same shapes, same vocabulary, one mental model:

- **`org_departments`** — created by a System manager, never hardcoded (the org still
  cannot say how many there are). Creating one SEEDS its permanent LEAD and MEMBER roles;
  deleting it cascades them away.
- **`org_department_domains`** (migration 0019) — WHAT each department owns. Ryan,
  27 Jul 2026: _"supplier leads would be able to read the PII of anything supply-related."_
  The operative word is RELATED, so a department owns DOMAIN KEYS — subject areas — rather
  than tagged rows, and an entity's department is whichever department owns the domain it
  lives in. `domain` is the PRIMARY KEY, so exactly one department owns each; claiming one
  takes it. The domain LIST is hardcoded in `@quagga/core` `org-domains` because it is a
  fact about the console's own routes (`registrations`, `suppliers`, `supplier_documents`,
  `questionnaires`, `bulletins`, `camp_categories`, `accounts`, `audit`) — the
  DEPARTMENTS remain data. A domain nobody owns is reachable only by an org-wide role.
- **`org_roles`** — `key`, label, `kind`, colour, a `permissions` JSONB object over the
  capability vocabulary, and an optional `department_id`. `kind = system` is seeded,
  UNDELETABLE and RIGHTS-EDITABLE (Ryan's "set permanent ones"); `kind = custom` is a
  System manager's own, fully editable and deletable. Only `custom` deletes — exactly
  `UNDELETABLE_ROLE_KINDS` on the camp side.
- **`org_role_assignments`** — membership × role; a person holds zero or more.

The two seeded system roles carry EXACTLY the rights the hardcoded ranks carried, so the
change of mechanism was not also a change of access — but they are now DEFAULTS OF A ROW,
not law:

| capability                                     | Engineer (seeded)  | Org staff (seeded) | System manager (`god`) |
| ---------------------------------------------- | ------------------ | ------------------ | ---------------------- |
| `read` — the whole console                     | ✅                 | ✅                 | ✅                     |
| `read_personal_information`                    | ❌                 | ✅                 | ✅                     |
| `write` — reviews, standings, bulletins, sends | ✅                 | ✅                 | ✅                     |
| `delete` — destructive removals                | ❌                 | ✅                 | ✅                     |
| `manage_camp_categories`                       | ❌                 | ❌                 | ✅                     |
| `manage_accounts` — grant access, assign roles | ❌ never grantable | ❌ never grantable | ✅                     |
| `read_system` — the System panel (`/system`)   | ✅                 | ❌                 | ✅                     |

**A System manager may edit any of those ticks** — with ONE ceiling, added 27 Jul 2026
with the tier correction below: the `engineer` RANK never resolves
`read_personal_information` or `delete`, whatever role it is given
(`ENGINEER_RANK_CARVE_OUTS`). Every other tick is data, and every edit is audited
(`org.role.update` records before/after).

**The ranks are cumulative in REACH, not in DEPTH** (Ryan, 27 Jul 2026: _"you got org staff
and then whatever departments they're in. You can have an engineer who is still also org
staff but they're a step up and then sys admin or gods are still org but they're above
that"_). All three are org; what differs is how many departments their grants apply in:

| rank        | reach                                                       | depth                                            |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `org_staff` | the departments whose roles they hold (org-wide roles: all) | whatever their roles grant                       |
| `engineer`  | EVERY department, always — they run the system              | **never** personal information, **never** delete |
| `god`       | everything                                                  | everything, whatever any row says                |

So the engineer tier is **not a superset of org_staff**: broader in reach, deliberately
narrower in depth. Given identical roles, an org_staff account can read a phone number and
destroy a supplier and an engineer cannot, anywhere. The cost is stated rather than hidden:
an engineer who genuinely needs people's details cannot be given them by a role edit — they
need the org_staff door. That is the safe direction of the trade, because an engineer's
universal reach with no ceiling is one role assignment away from every burner's details in
every department at once.

**Four rails keep editable rights survivable** (each has a named lockout test in
`apps/org/lib/__tests__/org-role-lockout.test.ts`):

1. **`memberships.role = 'god'` is the anchor.** A System manager resolves every
   capability whatever the role rows say — with zero roles, or holding a role that grants
   nothing. No table edit can define them out of existence, and the GOD_EMAILS bootstrap
   still works against an empty `org_roles`.
2. **The sole System manager cannot be removed or demoted.** A `god` membership is
   untouchable from the accounts panel in either direction, and `god` is not in the
   grantable set.
3. **Only a System manager manages departments, roles or assignments** — guarded on the
   anchor (`requireSystemManager`), never on a capability, because this is the surface that
   edits capabilities. `manage_accounts` is refused to EVERY role by the resolver itself,
   so even a hand-written row cannot escalate.
4. **Fail closed.** An account with the door and no roles clears the gate and resolves
   nothing — the correct state, said out loud in the UI rather than left to be discovered.

**Department scoping is a role's department × its department's domains.** A role scoped to
a department grants its scoped capabilities only for what that department OWNS. Three
questions, three functions, and using the wrong one is the whole hazard: `orgCan` asks "may
they, anywhere?" (the right question for a nav entry), `orgCanIn(actor, cap, departmentId)`
asks "may they, in this department?", and `orgCanInDomain(actor, cap, domain)` is what
guards and queries actually ask — a call site knows which screen it is on, never a
department id (which is data a System manager can change). A null-department role is
org-wide; a domain nobody owns is reachable only by an org-wide role; a department that
owns nothing makes every role scoped to it grant nothing, and the console says so
(`departmentDomainsNote`) rather than letting it be discovered by a refusal.

**TWO capabilities are department-scoped** (`DEPARTMENT_SCOPED_CAPABILITIES`):

- **`delete`** — destruction, scoped first, and the one that cannot be undone.
- **`read_personal_information`** — scoped 27 Jul 2026, and the reason this change exists.
  A Suppliers lead reads supply-related contact details and is REFUSED a theme camp's
  members. While it was global, a department lead read everyone's — silently, in an RSC
  payload, with no refusal anywhere to notice.

`read`/`write` are deliberately NOT scoped: ordinary work spans a console whose screens
mostly are not filed under anything, and confining it would turn every departmental role
into a role that looks granted and does nothing.

**The roles are NOT a ladder**, and now cannot become one: they are sets of grants that
need not nest. Any check shaped like `rank >= org_staff` is wrong in both directions — ask
`orgCan`.

**Personal information is enforced at the QUERY, PER DOMAIN, never in the JSX.** Every org
query that returns a person resolves `canReadPersonalInformationIn(actor, domain)` BEFORE
its select (the `canViewMedicalNotes` pattern), NAMING the part of the console it serves —
`accounts` for the accounts screen and the org-access roster, `registrations` for a camp's
members and officers, `suppliers` for supplier notes, `questionnaires` for results, `audit`
for the trail and the medical-access log. The domain argument is the enforcement, so the
predicate takes no default and the un-domained `canReadPersonalInformationAnywhere` is for
affordances only — a regression test refuses it in any server read model. A refused
caller's payload never contains medical notes,
phone numbers, emergency contacts, ID/passport, legal names or email addresses — not even
as an unrendered field. Two consequences worth stating: the accounts search matches on
username only for such a caller (an email match would be a lookup oracle), and the
medical-access audit panel is withheld whole, because a `bio.medical.view` row only exists
when its subject HAS notes, making the list a census of who has disclosed. Questionnaire
RESULTS are refused for the same reason. **The medical predicate reads the same resolved
capability** (`MedicalAccessContext.actorOrgPersonalInformation`) in both apps, so who the
org's safety tier is has one definition — a console door with no roles is not it. Access is
never self-service: the door (`engineer`/`org_staff`) and every role are granted by a
System manager; `god` comes solely from a verified `GOD_EMAILS` address.

`/` overview · `/accounts` (search users; the System manager grants/removes console access
and assigns org roles; each row shows the RESOLVED union of those roles — including what
the person can delete and where — so a reviewer never adds up chips by hand; audit
logged) · `/system/roles` (inside the System panel; see below) ·
`/registrations` (table: status/sound/new-vs-returning
filters) ·
`/registrations/[id]` (full submission read; per-section comment + open/resolve;
actions: approve / request changes / reject — approve flips the entitlement predicate) ·
`/suppliers` (imported list, vetting status editing, manual add) · `/categories` (the
per-edition camp-category taxonomy — readable by every rank, CRUD by the System manager
alone) · `/system` (below). There is NO
/payments section (Ryan, 24 Jul: "we don't do payments") — the payments table and
PaymentDetailsBlock survive only for future logistics apps.

## The System panel — `/system` (Ryan, 27 Jul 2026)

> "There should probably be a System management panel for IT staff and System manager
> teams to manage certain IT specific settings, security controls, and god level account
> management."

Gated on `read_system`: **engineer and System manager only**. It **surfaces existing
machinery — it invents none.** Every state it shows already existed and already degraded
honestly; each was honest in its own corner, so the person debugging had to know which
file to read. Four sections:

- **System health** — probed while the page renders, not read back off config ("the
  variable is set" and "the service answers" are different claims): a real timed database
  round trip; the migration verdict from `planMigration`, _the same function the build
  calls_, including the exact sentence a deploy would fail with; whether reference data has
  ever been seeded; auth secret, Resend, blob and `PGCRYPTO_KEY` presence.
- **Security controls** — what the auth stack is _actually_ enforcing, derived from
  @quagga/auth's own resolvers so the page can never report a rule the stack is not
  applying: email verification and **why** (derived from `RESEND_API_KEY`, never a switch
  someone forgot), the `AUTH_RATE_LIMIT_*` ceiling, 2FA/passkey availability and passkey
  scope, session lifetime _including the cookie-cache caveat on revocation_, SSO cookie
  scoping, the Secure-cookie flag, Google, and the password policy.
- **Org access** — who holds console access, at what rank, in whose department, with the
  existing elevate/demote confirmation flow for a System manager, and a warning when only
  one System manager exists (core already refuses to let the last one self-delete; said
  here, it is something the org can act on _before_ it matters).
- **Roles and departments** — a count, and the way in to `/system/roles`.
- **A link to `/audit`**, the existing trail.

### `/system/roles` — the permission model itself

Editing what a role may do _is_ "god level account management", so it lives in this panel
rather than on the nav bar. **Two gates, deliberately different**: READING it needs
`read_system` (an engineer may look — the permission model is this deployment's
configuration, the same class of fact as the auth settings beside it), while CHANGING
anything needs the **`god` anchor**, never a capability, because this is the surface that
edits capabilities. Every action re-checks `requireSystemManager()` server-side; the
missing buttons are a courtesy. The one thing a reader does not merely have hidden is the
deletion-impact data — it carries the affected people's email addresses, so it is **not
queried at all** unless the viewer is a System manager.

Three screens, and each is built around stating a consequence rather than a permission
key — someone here is deciding what a colleague can destroy:

- **Departments** — create, rename, delete. Deleting names _every_ role that dies with it
  (the seeded lead/member pair AND any custom role scoped to it), names _every person_ who
  loses one, and counts the ones who would be left holding nothing at all ("they will keep
  console access and find it empty"). Nobody is stripped silently.
- **Roles** — org-wide first, then grouped by department. A permanent role renders with no
  delete control anywhere and the reason in words ("Suppliers needs a lead and a member, so
  this role exists as long as the department does"), never a disabled button. The rights
  editor is a checklist of consequences — "permanently removes a supplier and everything
  hanging off them… there is no undo", not `delete: true` — and it resolves the draft back
  before saving ("someone whose only role is this can…"). Deleting a custom role is its own
  confirm with its own holder count.
- **Assignment** — on `/accounts`, where it belongs, with the same resolved-union renderer
  as the table and a live preview of the draft selection.

- **What a department owns** — a checklist of the console's domains on each department,
  each naming what it covers and, when another department holds it, saying so ("Safety owns
  this today — ticking it takes it from them"). It is a PERMISSIONS change in an org-chart
  costume: giving Suppliers the `registrations` domain hands every Suppliers lead every camp
  member's medical notes, so it is System-manager-anchored like every other rights edit and
  audited (`org.department.domains`, recording before/after and who lost what). Domains no
  department owns are listed, because "only org-wide roles reach these" is the state a fresh
  deployment is in and a surprise if nobody says it.

The union arithmetic is `summarizeOrgActor` in @quagga/core: **one pure function** behind
the table cell, the dialog preview and the editor preview, so the console cannot describe
an access it would refuse. Every scoped grant it reports carries the DOMAINS it reaches, so
a scope with nothing behind it renders as "in Safety only — which owns no part of the
console, so this reaches nothing" rather than as access.

**It never prints a secret** — only whether one is set, and what follows. The single
deliberate exception is a database _hostname_, parsed out so a password in the connection
string cannot come with it. `GOD_EMAILS` is reported as a **count**: those are people's
email addresses and an engineer never receives one. A unit test seeds every credential env
var with a marker and asserts no marker survives into any rendered string.

**The frame exception is PAID OFF (27 Jul 2026).** This page shipped ahead of its frame —
a recorded exception to design-before-build — and the frames were drawn afterwards to
document what shipped rather than to redesign it:

| Screen          | Desktop frame | Mobile 360 frame |
| --------------- | ------------- | ---------------- |
| `/system`       | `bNbLs`       | `qhCyJ`          |
| `/system/roles` | `IXwNt`       | `gsiE0`          |

Both are assembled from the existing console vocabulary (PageHeading, Card, the
ResponsiveDataTable accounts table, the accounts panel's confirm-overlay dialog). `bNbLs`
deliberately draws the DEGRADED states — no Resend key, no blob token, a migration that
would refuse to run — because those are the states someone opens this page to read.
`IXwNt` draws the permanence reason where a permanent role's delete control would be, the
rights checklist as consequences, and the department-deletion dialog naming who it strips.
Do not reopen this exception for the next surface.

## Seeds (`packages/db/src/seed.ts`, runnable script, idempotent)

**Law (Ryan, 26 Jul 2026): seeds contain ONLY org-owned reference/catalog data. Every
burner, camp, membership, registration and questionnaire response — in every
environment, including the kickoff demo — is created live through the app.** There are
no seeded accounts. This supersedes the earlier seed set (Mad Hatters, Camp 404, six
fictional camps, fictional burners, payment references), which is deleted: seeded leads
carried placeholder `authUserId = seed:<email>` strings and could never sign in, so
every "sign in as the seeded owner" path was a dead end.

**Seeded:** org group "AfrikaBurn" (no memberships — staff elevate live via
`GOD_EMAILS`) · the two seeded ORG ROLES (Org staff, Engineer), insert-if-missing so a
System manager's own edits to their rights survive every later deploy — no departments and
no role ASSIGNMENTS, which are live acts · edition AfrikaBurn 2027 · the 8 canonical camp categories for that
edition · suppliers imported from the AB public sheet (CSV export of Google Sheet
`1XU2gAt5E9GczVHZWpcD0_CsEeE--iX9aWmnWd19bgMI`; committed as JSON snapshot so seeding
works offline) with their per-edition onboarding step maps and `user_id` **null**, so a
real supplier can self-register and claim the row by email overlap · one org-authored
questionnaire **template** (definition only — no activation, no audience, no responses).

**Never seeded:** users, burner bios, `theme_camp`/`artwork`/`mutant_vehicle` groups,
memberships, invites, registrations, supplier declarations, section reviews,
questionnaire activations/required actions/responses, notifications, bulletins, audit
events, supplier notes, payments.

An empty directory, registrations queue and status board on a fresh database are the
**correct** first-boot state. Close that gap with honest empty states, never a seeded row.

## Core logic that MUST have vitest coverage (`packages/core`)

`isRegistered` entitlement predicate · registration submit-gate (all six complete) ·
60-word counter · name normalization + similarity (trigram) · privacy hard-lock
enforcement · registration + review state machines (legal transitions only) · payment
reference generator · supplier CSV→JSON import parser.

## Explicitly NOT built

Containers (hint tile only) · attestation QR flows (only `profile_keys` generation) ·
payment processing/checkout · water/ice/gas · placement maps · PWA/offline · Inngest ·
Storybook · carry-forward between editions (single seeded edition).

_(pen.dev **is** used — `design/ab-initial-app.pen` is the design source of truth. It
was on this list when the list meant "no design tooling"; that changed.)_

## Burner Bio v3 additions (Ryan, 24 Jul 2026 — corpus-grounded)

- **`about`** — free-text bio "for the burns" (soft cap ~150 words, word counter), privacy-flaggable, default public.
- **`camp_history`** — repeatable entries of camps the burner has been part of, each either **linked** (type-ahead reference to a platform group) or **free text** (unlisted free camps, camps at other burns worldwide); optional event name (default AfrikaBurn) and years. Default public. Expect heavy free-text use.
- **`volunteering_interests`** — optional multi-select "What kind of volunteering are you into?" from the real Quaggapedia portfolio list: ARTeria, Box Office, Chillaz, DMV, Die Hek (Gate), Die Yskas (Ice), Greeters, Kitchen, Lost & Found, MOOP/Leave No Trace, Recycling, Rangers, Sanctuary, Throne Crew, Volunteer & Info Booth (+ free-text other). Inquiry only — no commitments implied. Default public.
- **Ranger section** (all optional, inquiry-framed): `ranger_training` (completed Dust Ranger training), `ranger_curious` (interested in doing ranger shifts), `green_dot_training` (Green Dot Ranger training — the emotional-support specialisation). Info links: the Rangers info/training page (facebook.com/afrikaburn.rangers) and rangers@afrikaburn.com exist today; anything else renders as a disabled "info coming" placeholder.
- **Future org audiences** (cheap resolver additions, note only): `ranger_curious`, `volunteers_interested:<portfolio>` — the whole point of asking is that org can later questionnaire exactly these people.
- Schema: appended migration; all new fields nullable; privacy flags extended (none hard-locked — this is all self-promotional data); onboarding gains a "Your burns & volunteering" step before the privacy step; profile + third-party public view render whatever is public.

## Camp categories ("theme topics") — org-defined directory taxonomy (Ryan, 24 Jul)

- **Org CRUD** on a per-edition category catalog (name, emoji optional, sort); camps
  pick theirs (multi-select, suggest ≤4) on the camp profile/registration; the
  **directory gains filter chips** by category.
- No formal taxonomy exists in the corpus — the survival-guide/WTF vocabulary plus
  registration fields ground this **proposed seed set** (org can edit freely):
  Family-friendly 🧸 · Food & drink 🍲 · Bar 🍹 · Music & sound 🔊 · Performance 🎭 ·
  Workshops & talks 🛠️ · Art & making 🎨 · Wellness & chill 🌿 · Games & play 🎲 ·
  Late night 🌙 · Quiet camp 🤫 · Inclusive space 🌈.
  (Family-friendly, food-gifting, operating-hours, and sound level already exist as
  registration data — categories complement rather than duplicate them; the directory
  may ALSO filter on those registration-derived facts, e.g. family-friendly comes free.)

## Org stats dashboard — the console landing page (Ryan, 24 Jul)

Replace the org overview with a proper **status board for running the burn** (current
edition): registered burners in the app (+ bios completed), camps by registration
status (draft/submitted/under review/changes requested/approved) with a funnel bar,
free vs registered camps, questionnaire completion rates for active sends, officer
coverage across registered camps (assigned vs outstanding), supplier onboarding
progress distribution + standings, MV/art registrations when they exist, recent
activity feed (audit events). Time-series where meaningful (registrations over the
weeks). Charts follow the dataviz standards (load the dataviz skill before authoring
any chart). This page IS the org landing — glanceable, no scrolling required for the
headline numbers.

## Notifications & bulletins (Ryan, 25 Jul 2026 — see docs/notifications-spec.md)

- Schema additions (append-only migrations as always): `bulletins` (edition_id,
  title, body_md, audience [same enum as questionnaire audiences], created_by,
  published_at, pinned) and `notifications` (account_id, kind, title, body, link,
  bulletin_id nullable, created_at, read_at). No new PII.
- Routes: `/notifications` in ALL THREE apps (shared pattern component, app accent);
  participant `/bulletins/[id]`; org `/bulletins` + `/bulletins/new`.
- AppShell gains NotificationBell (unread count); mobile headers likewise.
- Event hooks generate notifications from EXISTING actions only (registration
  decisions, wrangler assignment, role/officer acceptance, questionnaire release,
  supplier org-confirmations, security events). Bulletins resolve audiences through
  the questionnaire audience machinery — one resolver, two consumers.
- Email: Resend daily digest of unread + immediate ONLY for blocking questionnaires
  and registration decisions. In-app is source of truth (offline law).
- Law: bulletins are informational only (no data collection — fewer-forms);
  notifications never leak hard-locked fields; no payment notifications exist.

## Platform/database separation — RESOLVED (27 Jul 2026)

The question was whether the database and accounts should move to a separate owning
"platform" unit. **They did not need to.** `packages/db` is the single owner of schema
and migrations for all three apps, and `packages/auth` is the single owner of the
account system — one self-hosted Better Auth instance, one shared account pool, SSO
across the apex. That is the shape the separation was after, reached without a
separate deployable.

Still binding: **no per-app migration tooling.** `packages/db` migrates, everything
else imports the client and types. The research trail is in
the executed plan in
`docs/auth-platform-spec.md`.

## Status board KPI row (Ryan, 25 Jul 2026)

The four headline cards are: BURNERS (total + bios complete %), CAMPS (total +
registered/free split), MUTANT VEHICLES (total + registered/in-review), ARTWORKS
(total + grant requests). Same cards on the org Overview page. Numbers are **derived
live from real rows** — the canvas figures (47 camps = 28 registered + 19 free; 12 MV =
9 + 3) are illustrative design copy only, not a seed contract; nothing is seeded, so a
fresh database correctly shows zeroes until burners create camps.
