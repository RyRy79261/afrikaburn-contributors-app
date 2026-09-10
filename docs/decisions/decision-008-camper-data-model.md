# Decision 008 — Canonical camper data model

| Field | Value |
| --- | --- |
| **Status** | Open |
| **Raised** | 2026-07-29 (App Spec change record) |
| **Spec section** | §4 Camper Database and Camp List (`CDB-*`) |

## The question

Who owns a camper's personal record — the camper, or the camp administrator?

## The divergence

The App Spec §4 specifies **admin-managed camper records**: a camp administrator
maintains a database of their campers, including full name as shown on ID,
SA ID or passport number, nationality, email and mobile.

The MVP implements **the inverse** — self-owned "Burner Bios" attached to camp
rosters. The person owns their record, sets per-field privacy, and carries it
across camps and years. Ryan framed this as a shared cross-year burner profile
reusable across apps (group chat, 2026-07-24 16:41).

The spec's own §4 note (2026-07-29) records the inversion and leaves it open.

## Why the MVP went the way it did

- **POPIA surface.** An admin-managed table of ID numbers is a camp volunteer
  holding special personal information about dozens of people, with no audit
  trail and no way for the subject to correct it. The self-owned model makes the
  data subject the editor.
- **Fewer forms.** One bio, reused every year and across every camp, is the
  single biggest form-burden reduction available. Per-camp admin-entered records
  multiply the typing by the number of camps a person joins.
- **It is what the codebase does.** `burner_bios` is per user × edition, with
  hard-locked always-private fields, AES-256-GCM encryption on ID/passport and
  medical notes, and bounded retention (`@quagga/core` `id-retention.ts`).

The roadmap goes further and says Graham's admin-managed camper-identity database
"should likely *never* be built without a hard AB requirement — it's the opposite
of the self-serve bio model."

## What is actually still open

Not the storage model — that has shipped and works. The open question is narrower:
**do camps need any admin-managed identity fields at all**, and if so which, for
what stated purpose? The one purpose documented so far is on-site identity
verification against the ticket at the gate, which the bio already serves.

## What would resolve it

AfrikaBurn's data-posture decision, which the roadmap tracks as "Full-camper-list
vs minimal-contacts decision (default: minimal)".
