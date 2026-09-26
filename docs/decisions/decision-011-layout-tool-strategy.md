# Decision 011 — Theme-camp layout tool strategy

| Field | Value |
| --- | --- |
| **Status** | **Reopened 2026-09-26 — in scope** (see the update at the end) |
| **Raised** | 2026-07-29 (App Spec change record) |
| **Spec section** | §11 Theme-Camp Layout Tool (`LAYOUT-*`), and §12 which depends on it |

## The question

Does the platform build a layout designer — a small CAD-ish tool for drawing a
camp's footprint, structures and tent placement?

## Why it is deferred rather than undecided

Three facts, none of which are ours to change:

1. **No structured geo data exists.** There is nothing to build a canvas against.
2. **The official map is a PDF that arrives late**, every year.
3. **The layout changes annually**, so anything drawn against one year's map has
   a one-year shelf life.

The roadmap names the layout designer as the canonical example of a "big
speculative build that never blocks a release", parked in its own lane.

## What ships instead

Registration accepts **layout file uploads** (`s4_layout_upload_urls`) and
**placement-zone preferences** (`@quagga/core` `placement-zones.ts`, configurable
per edition year). A camp draws its layout however it likes and attaches the
file. That covers what review actually needs.

R1 adds a **staff-assigned erf label** as free text on the registration — see
[Decision 012](decision-012-map-erf-readiness.md). That is deliberately not a
layout tool.

## The trigger for revisiting

Graeme was arranging a meeting with town planner **Roger van Wyk** and **Kshetra**
to unblock mapping (group chat, 2026-07-29 10:50). The App Spec says §§11–13
should be revisited after that meeting.

If that meeting produces a stable erf grammar and a machine-readable map, this
decision reopens. If it does not, deferral stands and §§11–12 stay unbuilt.

## Note on §12

§12 (private tent placement under Bedouin tents) is ❌ Not implemented and
depends entirely on this foundation. It cannot be decided separately.

## Update — 2026-09-26 (Ryan Noble): reopened, in scope

The trigger above fired. The mapping meetings with AfrikaBurn spatial planning
took place (Aug and Sept 2026), and the "no structured geo data" premise no
longer holds: AfrikaBurn's GIS runs on QGIS with Postgres vector layers, and
read-only access to specific layers — theme-camp boundaries first — is the
agreed model, with changes returned to AfrikaBurn for manual merge
([research note](../sources/research/gis-spatial-data.md)).

Placement maps are therefore **in scope**, as GIS integration prep, and leave
`AGENTS.md`'s out-of-scope list. The build order follows the App Spec's own
ladder: v1 a generic planner against a drawn rectangle (no GIS dependency) and
the §12 tent-under-Bedouin packer on the same mechanism; v2 plot-specific once
formal layer access is granted; v3 neighbours. AI auto-layout stays out, as the
working group rejected it. It remains a big build in its own lane (roadmap
principle 5) and never blocks a release. Tracked as an epic in the issue tracker.
