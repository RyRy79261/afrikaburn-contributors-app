# Decision 007 — Application boundary: org vs camp flows

| Field | Value |
| --- | --- |
| **Status** | Open |
| **Raised** | 2026-07-29 (App Spec change record) |
| **Spec section** | §1 Development Direction (`PURPOSE-001`, `PURPOSE-002`) |

## The question

Should the compulsory AfrikaBurn-facing flows (registration, placement
submission, container/logistics) live in the same application as the broader
camp-planning tools (onboarding, shifts, budgets, camper lists)?

## What was said

- **Fin** argued for separate boundaries: a compulsory org-facing app distinct
  from a broader camp-planning app (group chat, 2026-07-22 09:56).
- **Graeme** acknowledged those concerns as valid (2026-07-22 10:42).
- The App Spec records the architecture integration strategy as **open pending
  further feedback from AfrikaBurn**.

## Where the code already stands

The MVP shipped **three** applications, which is a partial de facto answer nobody
has ratified:

- `apps/web` — participants and camps
- `apps/org` — AfrikaBurn staff review console, separately deployed
- `apps/suppliers` — supplier portal

They share one spine (`@quagga/auth`, `@quagga/core`, `@quagga/db`,
`@quagga/types`, `@quagga/ui`) and one database. So the boundary that exists is
*by audience*, not by compulsory-vs-optional.

What remains genuinely undecided is whether the camp-planning surface (shifts,
budgets, statistics, camper communications — App Spec §§5, 6, 7, 4a, all
currently ❌) belongs in `apps/web` or in a fourth application.

## Why it matters

It is cheap to decide now and expensive later. Every camp-management feature
added to `apps/web` before this is settled is a feature that has to move if the
answer is "separate app".

## What would resolve it

AfrikaBurn stating whether they want participants to meet one app or two.
