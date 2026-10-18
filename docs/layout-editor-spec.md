# Camp layout editor (v1) — Spec contract

| Field                  | Value                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Category**           | Engineering Spec                                                                                                                                                                                             |
| **Doc status**         | Active. v1 is built (#99, `2484e22`, 15 Oct 2026). This file is the scope contract and the library record; [`camp-layout-spec.md`](camp-layout-spec.md) holds Ryan's decisions and wins where the two differ |
| **Normative language** | Descriptive only                                                                                                                                                                                             |
| **Requirement IDs**    | Partial — App Spec §11 `LAYOUT-001`–`LAYOUT-038` (`LAYOUT-039`, `LAYOUT-043` stored, no UI); §12 `TENT-001`–`TENT-010`, `TENT-013`, `TENT-014`, `TENT-016`–`TENT-027`, `TENT-029`; §13 `ERF-002`             |
| **Owner / Updated**    | Ryan, 2026-10-18 (epic #62)                                                                                                                                                                                  |

A camp plans its layout **at home, before the event**: a plot to scale in
metres, objects dragged from a palette, and a Bedouin that opens as its own
small plot for the tents under it. On site there is **zero connectivity**, so
nothing on site depends on the app. The on-site artefact is paper.

The editor is deliberately **not** offline-capable — no PWA cache, no local
copy. App Spec §"Offline" (`docs/sources/app-specification/app-specification.md`
line 53) restricts offline functionality to the container, gas and water
projects. The layout is used offline only as paper.

**Before you go.** The two artefacts are not equal:

- **Print plan** (`/camps/[slug]/layout/print`): the whole camp, every covered
  area drawn below it, the object list, scale bar, dimensions and legend. It is
  server-rendered, so it must be **printed or saved as PDF at home**. It does
  not exist once you are off the network.
- **PNG** (Download PNG): only the area on screen — the whole camp **or** one
  Bedouin — with no object list. Useful for sharing, not a substitute for the
  print.

Nothing in v1 prompts members to do this. A "Before you go: print or save as
PDF" hint on the read-only view and the print page is proposal P4 below.

The editor replaces a form and adds none: a drawn layout satisfies section 4
instead of the diagram upload (`s4AreaDimensions` **or** `hasLayout`,
`packages/core/src/registration-sections.ts`), and the wizard shows "From your
layout: 40 m × 30 m · 1,200 m²" instead of asking for it.

## Scope: in v1 and out

Every LAYOUT, TENT and ERF requirement is pre-event planning. "During" marks
what is out because it would need on-site connectivity or live field data.

| Requirement                                                                                            | v1                                                                                                                                                         | When                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `LAYOUT-001`–`031` object types                                                                        | Built — edition-scoped catalogue, sizes marked as estimates                                                                                                | Pre-event           |
| `LAYOUT-032`–`035` width, length, diameter, rotation                                                   | Built — inspector inputs, handles with metre readout, snapping. The inspector labels `length` **"Depth"**, deliberately, to match the plot's Width × Depth | Pre-event           |
| `LAYOUT-036`/`037` clearance and safety halos                                                          | Built — halos plus warnings                                                                                                                                | Pre-event           |
| `LAYOUT-038` label                                                                                     | Built — inspector field, drawn on the plan, the print and the org snapshot                                                                                 | Pre-event           |
| `LAYOUT-039` notes                                                                                     | **Partly — stored, no UI.** `notes` is in the Zod schema; nothing writes or shows it                                                                       | Pre-event           |
| `LAYOUT-040` ownership                                                                                 | Partly — free-text label only (decision 7)                                                                                                                 | Pre-event           |
| `LAYOUT-041`/`042` power and water, totals against orders                                              | Out — v1.x candidate                                                                                                                                       | Pre-event           |
| `LAYOUT-043` public or private                                                                         | **Partly — stored, no UI.** See "visibility" under Data model                                                                                              | Pre-event           |
| `TENT-001`/`002` Bedouin size, usable covered area                                                     | Built — nested area, editable down from the footprint                                                                                                      | Pre-event           |
| `TENT-003`, `005`, `006`, `013`, `014` poles, walkways, entrances, paths, accessible space             | Built — ordinary objects in the "Inside a Bedouin" palette (`support-pole`, `walkway`, `entrance`, `accessible-space`)                                     | Pre-event           |
| `TENT-004` guy-rope and rigging exclusion zones                                                        | Built — **not** an object: the shade structure's clearance halo outside its covered area, drawn as guy ropes; `TENT-027` warns on it                       | Pre-event           |
| `TENT-007`–`010`, `016`–`023` tent sizes, custom, drag, rotate                                         | Built                                                                                                                                                      | Pre-event           |
| `TENT-024`–`027`, `029` overlap, blocked path, on a pole, rigging zone, exceeds covered area           | Built — advisory warnings                                                                                                                                  | Pre-event           |
| `TENT-011`, `012`, `015`, `028`, `030`–`034` auto-arrange, spacing, capacity, access, scoring          | Out — gis-placement-spec §F.3: not before a real camp uses v1                                                                                              | Pre-event, deferred |
| `ERF-002` plot dimensions                                                                              | Built — plot summary                                                                                                                                       | Pre-event           |
| `ERF-001`, `003`–`011` fit against a real erf, neighbours, sound orientation                           | Out — v2, phase-gated (GIS Phase 0)                                                                                                                        | Pre-event, gated    |
| `ERF-012`–`017` suggestions, shared infrastructure, a better erf                                       | Out — last in the plan                                                                                                                                     | Pre-event, gated    |
| `ERF-018`–`023` AfrikaBurn proposes a layout; the camp approves, rejects, comments, revises, resubmits | Out — v2, gated, and only after `ERF-018` exists. These are the **camp's** responses to a layout AfrikaBurn sends back (App Spec §13, ~line 780)           | Pre-event, gated    |
| Physical placement, on-site re-survey, on-site edits                                                   | Out — the printed plan covers it                                                                                                                           | **During — out**    |

**Not `ERF-021`.** AfrikaBurn's reviewers can already comment on section 4
through the registration's ordinary section-review thread (`section_reviews` on
`size_logistics`), and the camp answers by resubmitting (each resubmit pins a
new snapshot). That is the registration's review loop, not `ERF-019`–`023`,
which run the other way.

## Data model (plot-local / ERF-local metres)

Types in `packages/types/src/camp-layout.ts`; validation in `@quagga/core`.
Metres and degrees. Origin at the frontage-left corner, x along the frontage,
y into the depth, right-handed (gis-placement-spec §B.4).

```ts
type Vec = [x: number, y: number]; // metres
type LayoutDocument = { schemaVersion: 1; plot: LayoutArea };
type LayoutArea = {
  boundary:
    | { kind: "rect"; width: number; depth: number }
    | { kind: "polygon"; ring: Vec[]; source: "gis"; sourceRef: string };
  frontageEdge?: number; // int ≥ 0, an index into the boundary's ring; a rect's edge 0 is the x axis
  objects: LayoutObject[];
};
type LayoutObject = {
  id: string;
  catalogKey: string;
  shape: "rect" | "circle";
  centre: Vec;
  width: number;
  length: number;
  diameter?: number;
  rotationDeg: number;
  clearanceM: number;
  safetyM: number;
  label?: string;
  notes?: string;
  visibility: "public" | "private";
  child?: LayoutArea; // nestable catalogue entries only, depth 1
};
```

- **Child frame.** A covered area has its own metres: origin at the covered
  area's corner, axes **rotated with the parent** (`childFrame` in
  `@quagga/core`). The covered area's centre sits on the parent's centre at any
  rotation, so turning a Bedouin turns its tents with it and their stored
  coordinates do not change.
- **`visibility`** is the object's place in the camp — public-facing (frontage,
  gift space, bar) or a private area (tents, vehicles, the `private-camping`
  area) — set from the catalogue default. It is **not** a data-exposure switch:
  the whole layout is members-only whatever it says. v1 stores it and shows it
  nowhere.
- **Rect to GIS polygon.** When AfrikaBurn's outline replaces the rectangle
  (v2), objects keep their ERF-local coordinates. Anything that no longer fits
  raises the ordinary out-of-bounds warning. Nothing is moved or deleted
  automatically.
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

## Carry-forward (decision 12, as built)

"Start from last year's layout" (`copyLayoutForNewEdition`,
`apps/web/lib/camp-layout-store.ts`) copies last edition's document into a new
`camp_layouts` row. As built:

- **(a) It satisfies section 4's dimensions with last year's size.** The copy
  is a layout row, so `hasLayout` is true and the wizard reads "From your
  layout" before anyone has looked at it this year. Decision 12 says "never
  mark section 4 complete because of it". Section 4 still needs
  expected population and first arrival date, so the section is not complete
  on the copy alone, but the dimensions condition is met. **Open question 5.**
- **(b) A GIS polygon becomes its bounding rectangle**, objects shifted so the
  rectangle starts at 0, 0. Next year's erf is not last year's.
- **(c) Free-text labels are copied as they were**, so "Alice's tent" appears in
  next year's plan to next year's members, who may not include Alice. **Open
  question 6** (clear tent labels on copy, or mark them "last year's").
- **(d) One retired catalogue key refuses the whole copy**
  (`checkLayoutAgainstCatalog`). Dropping the off-catalogue objects with a
  notice would be kinder. **Open question 6.**

## Access

- **Edit:** lead, admin, or the `manage_layout` privilege.
- **View:** any current member, read-only. Everyone else gets "Camp not found."
- **Warnings:** editors only, **at any width** — an editor on a phone sees the
  Warnings card and the apricot outlines on the compact plan
  (`layout-read-only.tsx`); plain members see neither, and the org snapshot
  carries none.
- **Org:** the registration-read capability, the pinned snapshot only, under
  section 4 (`layout-snapshot.tsx`). As built it draws the **whole-camp plan
  only**: no object list, no way into a covered area, no print and no PNG. A
  Bedouin is an empty box to a reviewer, and tent packing under it is not
  shown. Whether that is intended is **open question 4**; the frames
  `u2nN9j`/`M3Koy` show the build.

## Routes and surfaces

| Surface                             | Route / file                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Editor and nested Bedouin           | `apps/web/app/(app)/camps/[slug]/layout/page.tsx`, `components/layout-editor/*` |
| Member read-only plan + object list | same route, `components/layout-view/*`                                          |
| Print plan                          | `/camps/[slug]/layout/print`                                                    |
| Camp page tile                      | `components/layout-view/layout-tile.tsx`                                        |
| Wizard section 4 card               | `apps/web/components/registration/layout-section-card.tsx`                      |
| Org console, section 4 snapshot     | `apps/org/components/registration/layout-snapshot.tsx`                          |
| Placement CSV (plot size only)      | `@quagga/core` registration export                                              |

Below 768 px everyone gets the read-only view (decision 13): SVG with pinch and
pan (react-zoom-pan-pinch). The editor is never mounted on a phone. On a phone
the order is header, plan, warnings (editors), object list, then Download PNG
and Print plan.

## Frames

Built frames: L1 `f3jmCq`/`vnpZw`, L2 `LcZsE`/`PGk6q`, L3 `QZeG7`/`t7aOZ3`.

Reference frames drawn 18 Oct 2026, copied from L1–L3 and `PRDdG` so the
patterns are not redrawn. **Rule: they match the build string for string and
element for element, except the proposals listed below, each of which is
labelled on the canvas.** A design review that finds any other difference has
found a defect in the frame or the build.

| Frame                          | Desktop  | Mobile 360 | What it adds to L1–L3                                                                                                           |
| ------------------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Main view                      | `XoCoT`  | `oOWQE`    | Phone: build subtitle, warnings card kept, 44 px rows, buttons last. Desktop: state ④ is proposal P1; label hint is P2          |
| Inside a Bedouin               | `B4UJOS` | `ATxMF`    | Phone: "· 22 inside" (12 poles count), this area's warnings only, Download PNG / Print plan last. Desktop: label hint is P2     |
| First time, size the plot      | `Nghfo`  | `uSO9E`    | The empty state as its own page, plus Other states: ① no plan last year, ② size out of range                                    |
| Org review, section 4 snapshot | `u2nN9j` | `M3Koy`    | Full console page; no warning count and no warning outlines (as built); Request changes in the rail; 44 px Resolve on the phone |

Known drift inherited from L1/L2 and **not** corrected here (fix in the next
frame pass): the phone's "Last saved" lines sit below the list instead of
inside the plan card; the nested list is headed "Inside Bedouin 1" (build: "N
objects") and groups poles as "Support poles × 12" (build lists each).

## Proposals for Ryan (not built)

| #   | Proposal                                                                                                                                                                                                                       | Where drawn                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| P1  | **Download plan data (.json).** A client-side download of `LayoutDocument`, labelled so it does not promise GIS compatibility. Desktop only                                                                                    | `XoCoT` state ④ only        |
| P2  | Label hint names every audience: "Free text. Your camp's members, and AfrikaBurn once you submit, see it. Don't add contact or medical details." (build: "Free text, not linked to anyone. Every member of the camp sees it.") | `XoCoT`, `B4UJOS` inspector |
| P3  | Prefill the empty plot's Width and Depth from section 4's `s4AreaDimensions` when it parses as W × D; else 40 × 30. Asking twice breaks "derive over ask"                                                                      | Not drawn                   |
| P4  | "Before you go: print or save as PDF at home" hint on the read-only view and the print page                                                                                                                                    | Not drawn                   |

## Library choice

Decision 1 (Ryan, 14 Oct 2026): **react-konva for editing, server-rendered SVG
for every read-only view.** Konva is imported in one module
(`editor-stage.tsx`), loaded with `next/dynamic({ ssr: false })`. Its
Transformer gives the resize and rotate handles (`rotationSnaps` every 15°).
Snapping to 0.5 m, undo/redo and nested areas are ours, in metres, so no
library model leaks into the document. PNG export is
`stage.toDataURL({ pixelRatio: 2 })` in the editor; the read-only view
rasterises its SVG.

**Locked in `pnpm-lock.yaml`:** `konva@10.8.0`, `react-konva@19.3.0`,
`react-zoom-pan-pinch@4.2.0` (`apps/web/package.json` ranges `^10.8.0`,
`^19.3.0`, `^4.2.0`). The table below is **latest on npm**, taken 18 Oct 2026
with `npm view <pkg> version license time.modified peerDependencies` and
`https://api.npmjs.org/downloads/point/last-week/<pkg>` (week 10–16 Oct);
unpacked sizes are `npm view <pkg> dist.unpackedSize`.

| Library                                        | Licence                                                                                                                                                                     | Latest release     | Weekly downloads | React 19 / Next 16       | Touch / pinch                                                                          | Handles                                                  | Unpacked         | SSR                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------- | ------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| **konva 10.9.0 + react-konva 19.3.2** (in use) | MIT / MIT                                                                                                                                                                   | 15 Oct 2026        | ~1.79M / ~1.39M  | Yes (peer react ^19.3.0) | Touch and drag built in; two-finger pinch needs a small handler, not in our editor yet | Transformer: resize, rotate, rotation snaps; groups nest | ~1.9 MB + 0.1 MB | Client only; `ssr:false` already. Canvas peers optional, Node only                |
| **react-zoom-pan-pinch 4.2.0** (in use)        | MIT                                                                                                                                                                         | 3 Sep 2026         | ~1.39M           | Yes (peer react `*`)     | Pinch, pan, double-tap — the phone's read-only plan                                    | n/a (transforms a child)                                 | ~1.2 MB          | Client component (`plan-viewport.tsx`); the SVG inside is server-rendered         |
| tldraw 5.5.2                                   | tldraw licence, source-available, not OSI. Production needs a key; hobby licence is non-commercial with a watermark; trial phones home; downstream users need their own key | 2 Oct 2026         | ~242k            | Yes                      | Yes                                                                                    | Full editor UI, undo built in                            | ~15 MB           | Client only. Whiteboard model fights metres. **Licence blocks a public FSL repo** |
| @excalidraw/excalidraw 0.18.1                  | MIT                                                                                                                                                                         | 20 Apr 2026        | ~513k            | Yes                      | Yes                                                                                    | Full app, hand-drawn look                                | ~47 MB           | Client only. A finished app, not a toolkit                                        |
| fabric 7.4.0                                   | MIT                                                                                                                                                                         | 18 May 2026        | ~597k            | No React binding         | Partial                                                                                | Built-in controls                                        | ~22 MB           | Client only. Would mean rewriting a working editor                                |
| react-moveable 0.56.0                          | MIT                                                                                                                                                                         | 3 Dec 2023 (stale) | ~306k            | No declared React peer   | Yes (gesto)                                                                            | DOM handles                                              | ~4.6 MB          | DOM only, no canvas or export. Wrong layer, unmaintained                          |

Zero connectivity on site does not change the choice: Konva is a client bundle
with no licence or network check. Nothing new was installed for this spec.

## Product-law and privacy check

- **Money:** none. No prices, fees or payments on any layout surface.
- **Fewer forms:** the layout replaces the diagram upload; dimensions are
  derived, not asked again. The empty-plot Width/Depth still ask once more
  than they need to (P3).
- **Privacy:** never public — the plan shows where people sleep and where the
  gas is (gis-placement-spec §H). Tents carry a free-text label, never linked to
  a member. No hard-locked or safety-visible field is touched.
- **Who reads a label:** every current member of the camp; **AfrikaBurn's
  reviewers**, through the snapshot pinned at submit; anyone holding a print or
  PNG. Editors write campmates' names into labels ("Alice's tent"), so the
  field's own hint should name all three (P2), following the
  consent-at-point-of-entry rule.
- **Downloads outlive membership.** A PNG or print, and a JSON file if P1 is
  approved, stays with whoever took it after they leave the camp. P1 adds no
  new audience over the PNG, but it is machine-readable.
- **Advisory only:** warnings never block a save or a submission.
- **Env-less boot:** no env vars; exports are client-side.
- **No AI auto-layout** (Decision 011). Nothing is written into AfrikaBurn's GIS.

## Open questions for Ryan

1. **Plan data (.json) download (P1).** Decision 16 left JSON out because its
   only named consumer (AfrikaBurn's GIS merge) has an unknown format. The
   epic's scope still says "export as image + JSON". Drawn only as `XoCoT`
   state ④; if approved, desktop only.
2. **Tablet pinch-zoom in the editor.** Decision 13 counts on Konva's touch
   support at ≥ 768 px, but two-finger pinch on the stage needs a small
   handler. Worth it if tablets are a real editing device.
3. **Phone bottom-sheet palette.** Not drawn: decision 13 makes phones
   view-only, so there is no palette to put in a sheet.
4. **What the org sees of covered areas.** Render each covered area under the
   snapshot (as the print page does) and give the org a print of the pinned
   snapshot — or keep tent packing out of AfrikaBurn's view on purpose?
5. **Carry-forward and section 4 (a).** Should the derived dimensions need a
   save in this edition, or should decision 12 be reworded to what is built?
6. **Carry-forward labels and retired objects (c, d).** Clear tent labels on
   copy? Drop off-catalogue objects with a notice instead of refusing the copy?
7. **P2–P4** copy and prefill proposals above.

## Not built

Everything marked Out above, plus: notes and visibility UI, free polygons and
lines, member-linked tent ownership, real-time co-editing, GeoJSON export, and
any write-back into AfrikaBurn's GIS.
