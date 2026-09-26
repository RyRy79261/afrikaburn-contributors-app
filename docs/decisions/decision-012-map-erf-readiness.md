# Decision 012 — Map / erf integration readiness gate

| Field | Value |
| --- | --- |
| **Status** | **Reopened 2026-09-26 — in scope**; gate partly met (see the update at the end) |
| **Raised** | 2026-07-29 (App Spec change record) |
| **Spec section** | §13 AfrikaBurn Map and Erf Placement (`ERF-*`) |

## The question

When is the platform ready to place a camp's layout onto an actual allocated erf,
and what has to exist before that work starts?

## The gate

Nothing starts until AfrikaBurn supplies:

- a **machine-readable map** (not a PDF that arrives in April), and
- an **erf grammar** — what an erf identifier actually looks like, and whether it
  is stable year to year.

Both are AfrikaBurn-owned and both are still outstanding. The roadmap tracks
"Site map / erf data format" in its blocker table.

## What changed on 2026-08-12

R1 needed erf and camp codes to unblock container booking, and waiting on this
gate would have blocked that indefinitely. So R1 ships the **smallest thing that
works without the gate**:

- `registrations.camp_code` — 2–8 alphanumerics, unique per edition, staff
  assigned, suggested from the camp name.
- `registrations.erf` — **free text**, normalized for case and whitespace and
  nothing else.

The erf column is deliberately `text` and deliberately unvalidated beyond a
length cap. `@quagga/core` `placement-codes.ts` says why in its header: a
structured column here would encode a format *we invented*, which AfrikaBurn
would then be obliged to match. When a real grammar arrives, that module is the
single thing that changes.

## What this does and does not resolve

**Routed around:** container booking and on-site logistics now have the handles
they needed. They never actually needed a map — they needed a short stable code
and somewhere to write down the erf a human decided.

**Still gated:** placing a layout *onto* an erf, erf-fit checking, and anything
that renders a map. §13's `ERF-*` requirements remain unimplemented.

## The trigger for revisiting

Same as [Decision 011](decision-011-layout-tool-strategy.md) — the Roger van Wyk
/ Kshetra mapping meeting.

## Update — 2026-09-26 (Ryan Noble): reopened, gate partly met

The mapping meetings happened. Of the two gate items, the **machine-readable
map** is on its way: read-only vector layers (theme-camp boundaries first) from
AfrikaBurn's QGIS/Postgres GIS, pending the formal access grant. The **erf
grammar** is still outstanding. Placement maps are now in scope (Decision 011),
so work that needs no erf grammar — the generic planner, the tent packer,
reading boundary layers once granted — may start. The erf column stays free
text until a real grammar arrives, exactly as above.
