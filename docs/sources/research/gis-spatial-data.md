# GIS / spatial-data research

> **Provenance:** adapted from working-group research, Sept 2026 (notes from two
> meetings with AfrikaBurn spatial planning, Aug and Sept 2026). External facts
> are **unverified by this repo**.
>
> **Scope:** placement maps are **in scope** as of 2026-09-26, as GIS integration
> prep ([Decision 011](../../decisions/decision-011-layout-tool-strategy.md),
> [Decision 012](../../decisions/decision-012-map-erf-readiness.md)). This file is
> research context, not a spec; the external facts below still need confirming
> with AfrikaBurn before anything is built against them.

Related Decision Records in this repo:
[011 — layout tool strategy](../../decisions/decision-011-layout-tool-strategy.md),
[012 — map / erf readiness](../../decisions/decision-012-map-erf-readiness.md).
The source research also cites an App Spec "Decision 016" for the 2027
container-placement gates; no Decision 016 exists in this repo's mirror.

The **Container App** is a separate, existing AfrikaBurn application covering a
camp's shipping containers end to end (buying, ordering, moving, on-site
placement, off-site storage). Only integration concerns with it are noted here.

## Org GIS landscape

- AfrikaBurn has spent roughly 2–3 years moving its mapping off
  Photoshop-style tooling onto a standalone GIS, led by the AfrikaBurn GIS /
  spatial-planning lead.
- The working desktop environment is **QGIS**. Data is moving from AWS onto a
  **local on-prem Postgres server at the AfrikaBurn office**, with per-layer
  user security for a small set of org-side users.
- Layers already collected: town infrastructure, theme-camp and art
  placements, drainage, contours, high-resolution imagery. Theme-camp
  boundaries are expected to shift somewhat this cycle.
- Accuracy is described as "within a metre". On-the-ground GPS capture
  (**QField**) is fit for purpose but not survey-grade — a planning aid, not a
  fix-all once on site.

## Access model (as described, Sept 2026)

- The app team would receive **read-only access to specific vector layers**,
  starting with theme-camp boundaries.
- Nothing is written back into the org GIS directly. Layouts and updates are
  sent to AfrikaBurn for **manual merge-back**; the org stays the system of
  record so its layers are not corrupted.
- "Maybe not an API for now" — simple access first, scale later. This GIS
  access is **not** this product's platform API (see [`../../sdk/`](../../sdk/README.md)).
- Access had **not** been formally granted at the time of the research;
  Decision 012 stays `proposed` until it is.

## Data provenance

- **Elevation is a DEM from drone photogrammetry, not LIDAR.** An aerial
  survey contractor flies an overlapping image grid and photogrammetry
  reconstructs the surface — better than broad contours, still a fairly rough
  model.
- Drainage lines are derived algorithmically from the DEM (lowest points);
  checked on the ground during the 2026 event and judged reasonably good, but
  they shift and need updating.
- Site-wide high-resolution imagery is on the order of **16 GB** per image;
  working it in real time needs a high-end local machine.
- Dunes / habitability are a next-cycle layer; imagery alone is not enough and
  sites need walking. Time-series imagery is planned to capture land shift.

## Integration direction (not a contract)

Intended round-trip (Aug 2026):

1. Camp designs a preferred layout and submits it as standard geospatial data
   (GeoJSON-class formats).
2. Org places the block.
3. Org sends final coordinates back.

2027 container-placement slice (Sept 2026), gated per the source's Decision 016:

1. Camp receives its allocated boundary as a vector file.
2. Camp places preset objects (rectangles for containers, circles, lines)
   inside that boundary.
3. Tool generates a layout plan for submission.

Leaflet / OpenStreetMap-class frontends were named as compatible. Org-side
storage is Postgres (PostGIS-class); the hosting was described differently in
the two meetings, so treat it as unsettled.

## Implications for `LAYOUT-*` / `ERF-*` (if scope ever changes)

- AfrikaBurn DPW is to supply final shapes and sizes for containers and other
  infrastructure; external GIS engineers' preset vector libraries may become
  the authoritative object-geometry source for App Spec §11 (`LAYOUT-*`)
  rather than this app inventing them.
- Theme-camp boundary vectors are the input a layout tool would need; imagery,
  DEM and drainage are context.
- Blocks are irregular (examples: 120 m × 60 m, 95 m × 60 m, some ~50 m) and
  often shared between camps, so layouts must sit at true scale.
- Cross-module erf propagation (gas / water / wood / container logistics)
  remains an open ambiguity in App Spec §13.

## Open items (not tracked as tasks here)

- Formal grant of read-only vector-layer access (Decision 012 gate).
- Alignment with AfrikaBurn IT on auth / architecture.
- Confirmation from the AfrikaBurn placements lead that any tool fits the
  existing allocation workflow (allocations land around late January).
- DPW final container / infrastructure specs.
- An org-side privacy review before any adoption.
