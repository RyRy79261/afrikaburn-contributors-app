# Questionnaire Builder & Notification Gates — Feature Spec

*Ryan, 24 Jul 2026. The Camp 404 "captain questionnaire builder" pattern, generalized to
two authoring levels with audience targeting. The engine (definitions / activations /
responses / required_actions) already exists in the spine — this adds the builder UI,
audience resolution, custom project roles, and the gate/notification loop.*

## Authoring levels & audiences

**1. Org level — internal** (authored in the Organiser Console by org_staff/god):
- Audience: **org members**. Appears ONLY in the org console (a pending questionnaire
  gate inside the console, never in the participant app).

**2. Org level — outbound** (authored in the Organiser Console):
- Audience selector, one or more of:
  | Key | Resolves to |
  |---|---|
  | `all_current_burners` | every burner with a Burner Bio for the active edition |
  | `camp_leads` | leads/admins of any theme_camp group |
  | `registered_camp_leads` | leads/admins of camps with an **approved** registration this edition |
  | `mv_leads` | leads/admins of mutant_vehicle groups |
  | `mv_grant_requesters` | MV groups whose current-edition registration has `grants_interest = true` |
  | `art_leads` | leads/admins of artwork groups |
  | `art_grant_requesters` | artwork groups with `grants_interest = true` this edition |
- Delivered in the participant app (gate + notification). Grant-requester audiences
  resolve to empty sets until MV/art registration flows ship — that's fine.

**3. Project level** (authored by a project's lead/admin from its dashboard):
- Audience: the project's own members, selectable by **custom project roles**
  (or "everyone in this project").

## Custom project roles

- Structural roles (`lead | admin | member`) stay unchanged — they govern permissions.
- New: per-project **custom roles** — labels used for organisation + questionnaire
  audiences. Defaults seeded on project creation (Camp 404 basis): **Captain**,
  **Team lead**, **Burn member**. Leads/admins can add/rename/remove roles.
- A member can hold **multiple** custom roles (many-to-many).
- Schema: `project_roles` (group_id, name, is_default, sort) unique(group_id, name-normalized);
  `member_role_assignments` (membership_id × project_role_id).
- UI split (Ryan, 24 Jul — definition vs assignment are different activities):
  **role/officer DEFINITION lives on its own dedicated screen** —
  `/camps/[slug]/settings/roles` ("Camp Settings · Roles & Officers"), a full page,
  set-and-forget: create/edit roles with the complete privilege panel, color/emoji,
  officer registrations, deletion. NOT a sidebar or popover. Page structure (Ryan,
  24 Jul): **three sections, in this order — Officers, Core Roles, Custom Roles** —
  and every role row is **expandable** (accordion): collapsed = emoji, name, kind
  tags, one-line privilege summary ("Questionnaires (Burners only) · sees member
  details"); expanded = the full editor (privileges, sub-controls, emoji, color
  swatches, rename where allowed, delete where allowed). One row expanded at a time
  keeps the page scannable. The members area keeps
  only the frequent operations: role chips on member rows + a quick assign
  multi-select per member + a "Manage roles →" link to the settings screen.

### Roles v2 — permissions, color, emoji (Ryan, 24 Jul)

Roles carry **rights**, an **emoji icon**, and a **color**:

- `project_roles` gains: `color` (enum of ~8 curated palette keys derived from the brand
  ramp — teal, teal-deep, apricot, peach, sage, olive, rust, neutral — token-mapped at
  render so both themes stay legible; **not** freeform hex), `emoji` (single emoji,
  optional, validated), `permissions` (jsonb array of permission keys).
- **Privileges (Ryan, 24 Jul — creating a role means setting these).** `permissions`
  is a jsonb OBJECT (keys + config), not a bare list:
  | Privilege | Config | Grants |
  |---|---|---|
  | `view_member_details` | — | See private camp-held member info: ref codes, member emails, join dates, full member list detail. Without it: names, avatars, role chips only. |
  | `manage_questionnaires` | `{ audience_roles: "all" \| [role ids], may_block: bool }` | Create/edit/send project questionnaires and view their responses — but only targeting the configured role audiences, and blocking sends only if `may_block`. |
  | `assign_roles` | — | Assign/unassign *existing* roles to members. |
  | `manage_roles` | — | Create/edit/delete role definitions (implies `assign_roles`). |
  | `manage_members` | — | Create/revoke invites. |
  **Inviolable line:** no camp privilege ever overrides a burner's own privacy flags or
  the hard-locked bio fields (phone, emergency contacts, ID) — `view_member_details`
  gates *camp-held* data only, never bio privacy.
  Defaults: Captain 🎩 apricot = all privileges (questionnaires: all audiences,
  may_block); Team lead 🔧 teal = manage_questionnaires scoped to Burn-member
  audiences, no blocking + view_member_details; Burner 🔥 sage = none.
- **Structural roles are the permission backstop**: `lead`/`admin` implicitly hold every
  project permission and this cannot be revoked — so no permission edit can ever strand
  a camp (no self-lockout class of bugs, by construction). Custom-role permissions are
  *grants on top* for plain members.
- **Defaults (seeded, fully editable/deletable like any role)**: Captain 🎩 apricot —
  all three permissions · Team lead 🔧 teal — manage_questionnaires · Burn member 🔥
  sage — no permissions.

**CRUD semantics:**

| Op | Rule |
|---|---|
| Create | lead/admin or `manage_roles` holder; name unique-normalized per project; cap 20 roles/project |
| Read | every member sees names/colors/emoji on member rows; permission details visible to role managers |
| Update | rename is id-stable (assignments survive); recolor/re-emoji free; permission changes effective immediately |
| Assign/unassign | `manage_roles` (or lead/admin); members may hold multiple roles |
| Delete | **custom roles only** — confirm-with-count cascade ("11 members hold this role — remove it from them?"); assignments removed, memberships untouched. Default roles cannot be deleted (see kinds below) |
| Escalation | a `manage_roles` holder can grant any project permission incl. to themselves — accepted semantics at camp scale (role managers are trusted); leads can always revoke the role itself |

### Role kinds — default roles are permanent, aliasable fixtures (Ryan, 24 Jul)

`project_roles.kind ∈ captain | baseline | default | custom`:

| Kind | Seeded as | Rename | Icon/color | Permissions | Delete | Assignment |
|---|---|---|---|---|---|---|
| `captain` | Captain 🎩 | ✅ (alias) | ✅ | ❌ **locked to all** — UI shows disabled toggles + "Captains can do everything — that's what makes them captains" | ❌ | normal |
| `baseline` | **Burner** 🔥 | ✅ (alias — a camp may call its people anything; the DESIGN shows the default "Burner" with a rename affordance, not a pre-aliased example) | ✅ | ✅ editable (a camp may grant everyone something) | ❌ | **implicit — every member of the camp holds it, always**; cannot be unassigned. Not stored per member: derived (baseline = all members), so it can never drift |
| `default` | Team lead 🔧 | ✅ | ✅ | ✅ | ❌ | normal |
| `custom` | — | ✅ | ✅ | ✅ | ✅ (cascade) | normal |

Consequences: the "everyone in this project" questionnaire audience IS the baseline
role (one concept, not two); audience scoping that includes the baseline role means
"may target the whole camp". Aliases display everywhere (chips, audiences, completion
tables) — the kind stays stable underneath.

### Officer roles — org-defined, condition-triggered (Ryan, 24 Jul; corpus-grounded)

AB already instructs camps to appoint specific responsible people (Quaggapedia receipts):
"Nominate a safety officer to manage the safety aspects of your camp"
(personal-safety); "Designate a camp member as Safety Baron responsible for fire
safety and locating extinguishers" (fire-fire-safety); "Elect a Trash Officer to take
care of separating waste" (camping); "Safety Monitors on duty, multiple and visible"
(STAR theme-camp resources); LNT Lead is already a mandatory registration contact
(Finlay's form). We formalize these as a new role kind:

- **`officer` kind**: org-defined catalog (per edition), each with a **stable key**
  (org targeting anchor), seeded display name/emoji/color (camps may alias — the key
  never changes), and a **trigger condition** over the camp's registration data:
  | Key | Seeded as | Trigger |
  |---|---|---|
  | `lnt_officer` | LNT Lead ♻️ | always **required** (upgrades Finlay's contact-only LNT lead into an assignable role — deliberate supersession of the "no app role" rule; non-member contact fields remain as fallback) |
  | `safety_officer` | Safety Officer ⛑️ | always recommended |
  | `fire_safety_officer` | Safety Baron 🔥 | **required** when registration declares generators, open-flame gifting, or large fuel/gas storage; else recommended |
  | `sound_officer` | Sound Officer 🔊 | **required** when sound level ≥ 2 |
  | `safety_monitor` | Safety Monitor 🛡️ | recommended (STAR: "multiple and visible") |
- **Trigger mechanics**: when a camp's registration matches a trigger, the officer role
  appears in the camp's role system tagged *required* or *recommended*. Requirement is
  **soft-enforced**: the registration review (org side) and the camp dashboard show
  "Sound Officer — not yet assigned" as a completeness flag; approval gating on it is
  an org decision later, not hard-coded now.
- **Assignment is deferrable by design (Ryan, 24 Jul):** you often can't say who an
  officer will be when creating a camp — or even when submitting registration. Officer
  slots therefore NEVER block camp creation, registration submission, or approval;
  "not yet assigned" is a normal, long-lived state managed later from Camp Settings.
  The org's lever for chasing stragglers is the machinery we already built: a
  questionnaire/notification to registered camp leads with unassigned required
  officers ("Your camp declared Level 2 sound — who's your Sound Officer?").
- **Org questionnaire audiences extend** with `officer:<key>` selectors — e.g. **"All
  registered Sound Officers"** resolves to every member assigned `sound_officer` in a
  registered camp, regardless of camp-level aliases. This is the payoff: org can brief
  exactly the responsible people across all camps.
- **Officers are ALSO registrations (Ryan, 24 Jul):** assigning an officer is an
  **officer registration with the Org** — the org gains access to that officer's
  contact details (name, email, phone) for the function. Because phone is otherwise
  hard-locked private, **acceptance is a consent moment**: the member must accept the
  officer assignment, with explicit copy that their contact details are shared with
  AfrikaBurn for this role (POPIA consent-based processing). Declining leaves the slot
  unassigned.
- **Officers cannot be aliased** — org-facing vocabulary stays uniform across all camps
  (unlike defaults/baseline). Display name/emoji/color fixed by the org catalog.
- Camp-side **privileges for officer-role holders are settable as usual** by the camp.
- **Surface: a Camp Settings page** (`/camps/[slug]/settings`) hosting officer
  registrations (assign/accept state, org-shared contact preview) alongside the role
  system management; the members-card popover remains for quick role assignment.
- **Free camps: officers are entirely optional** — triggers/requirements apply only to
  camps with an in-flight or approved registration; a free camp may still assign
  officers voluntarily (nothing flags, nothing is required, org targeting only ever
  reaches officers of REGISTERED camps).

Authoring rights update: project questionnaires may be authored/sent by lead/admin **or
any member holding `manage_questionnaires`** (authz predicate + tests updated to match).

## Engine mechanics (Camp 404 pattern, already ported)

- Builder writes a `questionnaire_definitions` row (versioned JSON of fields — reuse the
  existing trimmed field kinds: text, textarea, select, multi-select, checkbox/consent,
  yes_no; plus title, description, per-field required flag).
- **Activation** = definition × edition × audience spec (jsonb) × options
  (`blocking` bool, `due_at` nullable). Activating resolves the audience **at send
  time** into `required_actions` rows (key `questionnaire:<activation_id>`) per user.
- **Notification gates**: on activation each targeted user gets (a) a required_action —
  if `blocking`, the app routes them to the fill page before anything else (Camp 404
  gate pattern; org-internal ones gate the console instead); if non-blocking, a
  dashboard banner + bell-style pending item; (b) an email via Resend (console-logged
  when unset).
- Submitting responses (existing `questionnaire_responses` store, JSONB by field id)
  flips the required_action to completed.
- **Blocking status must be explicit everywhere (Ryan, 24 Jul):** every surface that
  shows a questionnaire — pending cards, list rows, the fill page itself, the author's
  builder/activation views — carries a clear badge: **"Required — blocks the app until
  done"** (destructive/warning treatment) vs **"Optional"** (muted). A blocking
  questionnaire is a HARD gate: the participant (or console user, for org-internal)
  can do nothing else until it is submitted — the only reachable pages while gated are
  the fill page and sign-out. Non-blocking ones never impede navigation.
- **Completion tracking**: author-side list per activation — sent count, completed
  count, per-user status (org console for org sends; project dashboard for project
  sends). No public scoring.

## Surfaces

- **Org console** `/questionnaires`: list (definitions + activations w/ completion),
  builder (create/edit fields), activation flow (audience picker with live resolved
  count preview, blocking toggle, due date), results view (completion table + response
  viewing).
- **Participant app** `/camps/[slug]/questionnaires` (lead/admin): same builder scoped
  to the project, audience = role multi-select; completion table of members.
- **Participant app, member side**: blocking gate page reusing the existing
  QuestionnaireRunner; non-blocking = dashboard "Pending questionnaires" card.
- **Roles management**: members card gains role chips + lead-only editing.

## Guardrails

- Privacy: responses visible only to the authoring level (org sends → org console;
  project sends → that project's leads/admins). Never cross-project. Bio privacy rules
  unaffected.
- Fewer-forms test applies to *us*: the builder itself must warn authors ("Every
  question you add is a question someone in the desert has to answer") — small copy
  touch, real principle.
- Schema additions (this feature only): `project_roles`, `member_role_assignments`,
  `registrations.grants_interest` (nullable bool), plus whatever columns the
  activation options need if missing. Append-only migrations as always.
- Audience resolution is a pure, tested core function: `resolveAudience(spec, editionId)`
  returning user ids — every selector covered by vitest with seeded fixtures.

## Design frames to add (dialect + library instances, org frames apricot)

1. "Org Questionnaires — /questionnaires · Org Dark" (list + completion bars)
2. "Org Questionnaire Builder — /questionnaires/new · Org Dark" (field editor + audience picker with resolved-count preview + blocking toggle)
3. "Camp Questionnaires — /camps/[slug]/questionnaires · Dark" (lead view: list + builder entry + member completion)
4. "Questionnaire Gate — fill view · Dark" (member answering a blocking questionnaire; runner + "this unlocks your dashboard" framing)
5. Members card variant with role chips + role management popover (can be an added state on the Camp Dashboard frame or a small dedicated frame)
