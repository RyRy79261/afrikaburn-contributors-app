# Camp layout editor (v1) — Spec contract

| Field                  | Value                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                                                                                                                                               |
| **Doc status**         | Active. v1 is built (#99, `2484e22`, 15 Oct 2026). This file is the scope contract and the library record; [`camp-layout-spec.md`](camp-layout-spec.md) holds Ryan's decisions and wins where the two differ |
| **Normative language** | Descriptive only                                                                                                                                                                                               |
| **Requirement IDs**    | Partial — App Spec §11 `LAYOUT-001`–`LAYOUT-039`, `LAYOUT-043`; §12 `TENT-001`–`TENT-010`, `TENT-013`, `TENT-014`, `TENT-016`–`TENT-027`, `TENT-029`; §13 `ERF-002`, `ERF-021`                                  |
| **Owner / Updated**    | Ryan, 2026-10-18 (epic #62)                                                                                                                                                                                    |

A camp plans its layout **at home, before the event**: a plot to scale in
metres, objects dragged from a palette, and a Bedouin that opens as its own
small plot for the tents under it. On site there is **zero connectivity**, so
nothing on site depends on the app. The on-site artefact is paper: the print
plan (scale bar, dimensions, legend, every object in metres) and a PNG.

The editor replaces a form and adds none: a drawn layout satisfies section 4
instead of the diagram upload (`s4AreaDimensions` **or** `hasLayout`,
`packages/core/src/registration-sections.ts`), and the wizard shows "From your
layout: 40 m × 30 m · 1,200 m²" instead of asking for it.

## Scope: in v1 and out

Every LAYOUT, TENT and ERF requirement is pre-event planning. "During" marks
what is out because it would need on-site connectivity or live field data.

| Requirement                                                                                       | v1                                                             | When                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------- |
| `LAYOUT-001`–`031` object types                                                                   | Built — edition-scoped catalogue, sizes marked as estimates    | Pre-event                  |
| `LAYOUT-032`–`035` width, length, diameter, rotation                                              | Built — inspector inputs, handles with metre readout, snapping | Pre-event                  |
| `LAYOUT-036`/`037` clearance and safety halos                                                     | Built — halos plus warnings                                    | Pre-event                  |
| `LAYOUT-038`/`039` label, notes                                                                   | Built                                                          | Pre-event                  |
| `LAYOUT-040` ownership                                                                            | Partly — free-text label only (decision 7)                     | Pre-event                  |
| `LAYOUT-041`/`042` power and water, totals against orders                                         | Out — v1.x candidate                                           | Pre-event                  |
| `LAYOUT-043` public or private                                                                    | Built (`visibility`)                                           | Pre-event                  |
| `TENT-001`/`002` Bedouin size, usable covered area                                                | Built — nested area, editable down from the footprint          | Pre-event                  |
| `TENT-003`–`006`, `013`, `014` poles, rigging, walkways, entrances, paths, accessible space       | Built — ordinary objects in the "Inside a Bedouin" palette     | Pre-event                  |
| `TENT-007`–`010`, `016`–`023` tent sizes, custom, drag, rotate                                    | Built                                                          | Pre-event                  |
| `TENT-024`–`027`, `029` overlap, blocked path, on a pole, rigging zone, exceeds covered area       | Built — advisory warnings                                      | Pre-event                  |
| `TENT-011`, `012`, `015`, `028`, `030`–`034` auto-arrange, spacing rule, capacity, access, scoring | Out — gis-placement-spec §F.3: not before a real camp uses v1  | Pre-event, deferred        |
| `ERF-002` plot dimensions                                                                         | Built — plot summary                                           | Pre-event                  |
| `ERF-021` comment                                                                                 | Built — `section_reviews` on `size_logistics`                  | Pre-event                  |
| `ERF-019`/`020`/`022`/`023` approve, reject, revise, resubmit                                     | Partly — rides the registration's changes-requested loop       | Pre-event                  |
| `ERF-001`, `003`–`011` fit against a real erf, neighbours, sound orientation                      | Out — v2, phase-gated (GIS Phase 0)                            | Pre-event, gated           |
| `ERF-012`–`018` suggestions, AB-revised layout                                                    | Out — last in the plan                                         | Pre-event, gated           |
| Physical placement, on-site re-survey, on-site edits                                              | Out — paper print covers it                                    | **During — out**           |

## Data model (plot-local / ERF-local metres)

Types in `packages/types/src/camp-layout.ts`; validation in `@quagga/core`.
Metres and degrees. Origin at the frontage-left corner, x along the frontage,
y into the depth, right-handed (gis-placement-spec §B.4).

```ts
type LayoutDocument = { schemaVersion: 1; plot: LayoutArea };
type LayoutArea = {
  boundary:
    | { kind: "rect"; width: number; depth: number }
    | { kind: "polygon"; ring: Vec[]; source: "gis"; sourceRef: string };
  frontageEdge?: 0;
  objects: LayoutObject[];
};
type LayoutObject = {
  id: string; catalogKey: string; shape: "rect" | "circle";
  centre: Vec; width: number; length: number; diameter?: number;
  rotationDeg: number; clearanceM: number; safetyM: number;
  label?: string; notes?: string; visibility: "public" | "private";
  child?: LayoutArea; // nestable catalogue entries only, depth 1
};
```

- **Tables** (migration 0038, generated): `camp_layouts` (unique
  `registration_id`, jsonb `document`, `version` for compare-and-set) and
  `camp_layout_snapshots` (append-only, pinned in the submit/resubmit
  transaction; this is what the org reads).
- **Refused by Zod:** unknown `schemaVersion`, non-finite numbers, sizes outside
  0.1–500 m, a plot over 500 × 500 m, more than 400 objects, nesting deeper than
  1, a child on a non-nestable entry, over-long text, a document over ~256 kB.
- **Geometry** in `@quagga/geo` (pure TS): SAT overlap, clipping, polygon,
  snapping. It already handles a concave polygon boundary, so the v2 GIS outline
  needs no new geometry and no migration.

## Access

- **Edit:** lead, admin, or the `manage_layout` privilege.
- **View:** any current member, read-only. Everyone else gets "Camp not found."
- **Org:** the registration-read capability, snapshot only.
- **Warnings:** editors only — not plain members, not the org snapshot.

## Routes and surfaces

| Surface                                   | Route / file                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Editor and nested Bedouin                  | `apps/web/app/(app)/camps/[slug]/layout/page.tsx`, `components/layout-editor/*`    |
| Member read-only plan + object list        | same route, `components/layout-view/*`                                             |
| Print plan                                 | `/camps/[slug]/layout/print`                                                       |
| Camp page tile                             | `components/layout-view/layout-tile.tsx`                                           |
| Wizard section 4 card                      | `apps/web/components/registration/layout-section-card.tsx`                         |
| Org console, section 4 snapshot            | `apps/org/components/registration/layout-snapshot.tsx`                             |
| Placement CSV (plot size only)             | `@quagga/core` registration export                                                 |

Below 768 px everyone gets the read-only view (decision 13): SVG with
pinch and pan (react-zoom-pan-pinch). The editor is never mounted on a phone.

## Frames

Built frames (match the merged code): L1 `f3jmCq`/`vnpZw`, L2 `LcZsE`/`PGk6q`,
L3 `QZeG7`/`t7aOZ3`.

Reference frames drawn 18 Oct 2026, copied from L1–L3 and `PRDdG` so the
patterns are not redrawn. They record the decisions the earlier frames
contradicted and one open proposal:

| Frame                                     | Desktop  | Mobile 360 | What differs from L1–L3                                                                        |
| ----------------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Main view + plan-data proposal            | `XoCoT`  | `oOWQE`    | Third toolbar button "Plan data (.json)" (**proposal**, below); phone has no warnings; rows 44 px; phone gets PNG / Print buttons |
| Inside a Bedouin                          | `B4UJOS` | `ATxMF`    | Same toolbar proposal; phone has no warnings; rows 44 px                                       |
| First time, size the plot                 | `Nghfo`  | `uSO9E`    | The empty state as a page of its own, with a sizing hint                                       |
| Org review, section 4 snapshot            | `u2nN9j` | `M3Koy`    | Full console page; no warning count on the snapshot (as built); Request changes in the rail    |

## Library choice

Decision 1 (Ryan, 14 Oct 2026): **react-konva for editing, server-rendered SVG
for every read-only view.** Konva is imported in one module
(`editor-stage.tsx`), loaded with `next/dynamic({ ssr: false })`. Its
Transformer gives the resize and rotate handles (`rotationSnaps` every 15°).
Snapping to 0.5 m, undo/redo and nested areas are ours, in metres, so no
library model leaks into the document. PNG export is
`stage.toDataURL({ pixelRatio: 2 })`.

Re-checked on npm, 18 Oct 2026:

| Library | Licence | Latest release | Weekly downloads | React 19 / Next 16 | Touch / pinch | Handles | Unpacked | SSR |
|---|---|---|---|---|---|---|---|---|
| **konva 10.9.0 + react-konva 19.3.2** (in use) | MIT / MIT | 15 Oct 2026 | ~1.79M / ~1.39M | Yes (peer react ^19.3.0) | Touch and drag built in; two-finger pinch needs a small handler, not in our editor yet | Transformer: resize, rotate, rotation snaps; groups nest | ~1.9 MB + 0.1 MB | Client only; `ssr:false` already. Canvas peers optional, Node only |
| tldraw 5.5.2 | tldraw licence, source-available, not OSI. Production needs a key; hobby licence is non-commercial with a watermark; trial phones home; downstream users need their own key | 2 Oct 2026 | ~242k | Yes | Yes | Full editor UI, undo built in | ~15 MB | Client only. Whiteboard model fights metres. **Licence blocks a public FSL repo** |
| @excalidraw/excalidraw 0.18.1 | MIT | 20 Apr 2026 | ~513k | Yes | Yes | Full app, hand-drawn look | ~47 MB | Client only. A finished app, not a toolkit |
| fabric 7.4.0 | MIT | 18 May 2026 | ~597k | No React binding (imperative) | Partial | Built-in controls | ~22 MB | Client only. Would mean rewriting a working editor |
| react-moveable 0.56.0 | MIT | 3 Dec 2023 (stale) | ~306k | No declared React peer | Yes (gesto) | DOM handles | ~4.6 MB | DOM only, no canvas or export. Wrong layer, unmaintained |

Zero connectivity on site does not change the choice: Konva is a client bundle
with no licence or network check. Nothing new was installed for this spec.

## Product-law and privacy check

- **Money:** none. No prices, fees or payments on any layout surface.
- **Fewer forms:** the layout replaces the diagram upload; dimensions are
  derived, not asked again.
- **Privacy:** never public — the plan shows where people sleep and where the
  gas is (gis-placement-spec §H). Tents carry a free-text label, never linked to
  a member. No hard-locked or safety-visible field is touched. The plan-data
  download (if approved) is the same document members can already see; it adds
  no audience.
- **Advisory only:** warnings never block a save or a submission.
- **Env-less boot:** no env vars; exports are client-side.
- **No AI auto-layout** (Decision 011). Nothing is written into AfrikaBurn's GIS.

## Open questions for Ryan

1. **Plan data (.json) download.** Decision 16 left JSON out because its only
   named consumer (AfrikaBurn's GIS merge) has an unknown format. The epic's
   scope still says "export as image + JSON". If yes, it is a client-side
   download of `LayoutDocument`, labelled so it does not promise GIS
   compatibility. Frames `XoCoT`/`B4UJOS` show it; the build has no such button.
2. **Tablet pinch-zoom in the editor.** Decision 13 counts on Konva's touch
   support at ≥ 768 px, but two-finger pinch on the stage needs a small
   handler. Worth it if tablets are a real editing device.
3. **Phone bottom-sheet palette.** Not drawn: decision 13 makes phones
   view-only, so there is no palette to put in a sheet.

## Not built

Everything marked Out above, plus: free polygons and lines, member-linked tent
ownership, real-time co-editing, GeoJSON export, and any write-back into
AfrikaBurn's GIS.
