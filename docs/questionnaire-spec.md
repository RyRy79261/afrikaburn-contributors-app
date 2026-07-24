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
- UI: managed inline in the camp dashboard members area (assign via a small
  multi-select per member; role chips shown on member rows).

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
