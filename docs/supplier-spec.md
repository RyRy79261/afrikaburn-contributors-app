# Supplier Portal & Org Supplier Standing — Feature Spec

_Ryan, 24 Jul 2026. Suppliers get their own portal with a real onboarding; the org sees
exactly three things about any supplier: **did they onboard properly, what standing are
they in, and the notes trail** (infractions/blessings). The `source` field
(ab_sheet/manual) is dead — remove it everywhere._

## The supplier model, reduced to what matters

- **KILL `source`** (ab_sheet | manual) — dropped by migration, removed from every UI.
- **KILL `vetting_status`** (listed/registered/flagged) — replaced by:
- **`standing`** enum: `good | watch | suspended` — org-set, org-visible everywhere the
  supplier appears (incl. the camp-side supplier picker: `good` renders normal, `watch`
  shows a subtle caution, `suspended` is excluded from the picker).
- **Onboarding completion** — derived from the step checklist (below), shown as `n/7`
  progress; "onboarded properly" = all required steps done for the active edition.
- **`supplier_notes`** — org-internal timeline: `{kind: infraction | blessing | note,
body, author, created_at}`. Never visible to the supplier or to camps.

## Onboarding checklist (per supplier × edition; steps from the real Supplier Depot procedure in `docs/sources/quaggapedia/supplier-depot.md`)

| #   | Step key                 | Who completes                             | Who confirms                                                                                      |
| --- | ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `registration_form`      | supplier (portal form)                    | auto                                                                                              |
| 2   | `agreement_signed`       | supplier (acknowledgement)                | org may revoke                                                                                    |
| 3   | `deposit_paid`           | —                                         | **org confirms** ("deposit received" — tracked only, never processed; platform never holds funds) |
| 4   | `inventory_submitted`    | supplier (delivery inventory)             | org reviews                                                                                       |
| 5   | `crew_details_submitted` | supplier (crew names/IDs for site access) | org reviews                                                                                       |
| 6   | `briefing_attended`      | —                                         | **org confirms** (compulsory briefing)                                                            |
| 7   | `registration_fee_paid`  | —                                         | **org confirms** (tracked only)                                                                   |

Steps are a core catalog constant (edition-scoped overrides later if AB changes the
procedure). Self-service steps flip instantly; org-confirmed steps show
"awaiting AfrikaBurn confirmation" on the supplier side.

## Surfaces

**`apps/suppliers` — the supplier portal** (third app in the monorepo; own deployment,
own URL per the standing decision; same auth stack; email overlap links a burner
account):

- Landing/sign-in → onboarding checklist page: each step as a card with its
  Quaggapedia-derived content inline (the supplier rules FROM the corpus: depot-only
  operations, delivery windows, what can/can't be delivered, tenting deadlines,
  plug-and-play penalties — surfaced from `supplier-depot.md` + the 2026 rules images,
  so suppliers _read the rules where they act on them_).
- Their own standing is visible (`good/watch/suspended` with plain language); the org
  notes trail is NOT.
- Graceful env-less boot like the other apps.

**Org console `/suppliers` v2**: table becomes — supplier · onboarding progress
(`n/7`, incomplete highlighted) · standing (inline select) · notes (count badge →
drawer timeline with add-note form: kind selector infraction 🔴 / blessing 🟢 / note ⚪).
Row detail shows per-step status with org-confirm buttons for steps 3/6/7 and review
marks for 4/5. Audit events on standing changes and org confirmations.

## Guardrails

- Deposits/fees are **status-tracking only** — no amounts processed, consistent with
  the never-holds-funds law.
- Camp-side supplier picker keys off standing (suspended excluded) and onboarding
  completeness (incomplete suppliers shown with "onboarding incomplete" tag), replacing
  the old vetting badges.
- Notes are POPIA-relevant org records about businesses/persons — org-only, audit-logged.
