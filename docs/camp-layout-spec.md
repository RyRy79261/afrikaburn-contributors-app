# Camp layout editor — Feature Spec

| Field                  | Value                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                                                                                                       |
| **Doc status**         | Active — decisions taken 14 Oct 2026; frames next                                                                                                                            |
| **Normative language** | Descriptive only                                                                                                                                                       |
| **Requirement IDs**    | Partial — App Spec §11 `LAYOUT-001`–`LAYOUT-039`, `LAYOUT-043`; §12 `TENT-001`–`TENT-010`, `TENT-013`, `TENT-014`, `TENT-016`–`TENT-027`, `TENT-029`; §13 `ERF-002` |
| **Owner / Updated**    | Ryan, 2026-10-13 (epic #62)                                                                                                                                            |

Camps draw their layout on paper, or in a drawing app, and upload a picture of
it (`s4_layout_upload_urls`). Placement can't measure a picture, and the
placement staff place camps late. This gives a camp a scale plan in metres: a
rectangle the camp sizes itself, objects dragged from a palette, and a Bedouin
that opens as its own small plot for the private tents underneath it. This is
"v1 generic" from [Decision 011](decisions/decision-011-layout-tool-strategy.md).
It reads no AfrikaBurn map data. The plot outline is stored as a polygon in
plot-local metres, so the real allocated shape from GIS
([`gis-placement-spec.md`](gis-placement-spec.md)) can replace the rectangle
later with no migration and no change to the editor.

It replaces a form and does not add one (gis-placement-spec §F.4). A camp that
draws its layout here is not asked to upload a diagram as well. The upload stays
available for camps that prefer to draw elsewhere.

## Decisions (Ryan, 14 Oct 2026)

Answered: build v1 now (before GIS); nested Bedouin with hand-placed tents in
v1; leads + co-leads + a `manage_layout` privilege edit, all current members
view read-only, never public; tents carry a free-text label only; the org sees
the snapshot pinned at submit; next year is a one-click "Start from last
year's layout"; 360 is view-only. The canvas library is the engineer's call
(react-konva, chosen on the research in the library evaluation). The rest of
the list below are the recommended defaults, taken as decided.

Also decided on the frames (14 Oct): **warnings are shown to editors only**
(leads, co-leads, `manage_layout`) — not to plain members and not in the
org's snapshot view; **every current member may download (PNG) and print** the
plan. Frames: L1 editor `f3jmCq` / `vnpZw`, L2 inside a Bedouin `LcZsE` /
`PGk6q`, L3 read-only + tile + org snapshot + empty state `QZeG7` / `t7aOZ3`.
Where the L3 frame shows a warning count on the org snapshot, the build leaves
it out.

### The original proposals

Each question has a recommended default. Nothing below is built until these are
answered.

1. **Canvas library.** Use react-konva for the editor and plain server-rendered
   SVG for every read-only view. This overrides the SVG-only recommendation in
   gis-placement-spec §G. **Recommended: yes.** Konva and react-konva are MIT,
   actively maintained (both last released 15 Oct 2026), peer on React 19, and have the built-in Transformer for
   resize and rotate handles. tldraw needs a licence key in production, and
   Fabric.js and Excalidraw fit a metre-based document less well. (The
   evaluation note this once linked was never committed; checked again on npm
   18 Oct 2026.)
2. **Where the geometry code lives.** The spec planned a separate
   `@quagga/geo` leaf package for polygon maths (§D.1) and `@quagga/core` for
   policy. **Recommended: follow the spec.** v1 needs only a little geometry:
   rotated-rectangle and circle overlap, point-in-polygon, area and snapping. A
   new package is the right home, and it keeps CODEOWNERS-gated core focused on
   rules. Alternative: start as `@quagga/core/layout-geometry.ts` and split out
   once Phase 1 GIS work begins.
3. **Phasing against the GIS plan.** gis-placement-spec puts the camp editor at
   Phase 3, after ops allocation. Decision 011 (26 Sep) authorises it now,
   because it needs no AfrikaBurn data. **Recommended: build v1 now**, as
   Decision 011 allows. Record in gis-placement-spec that Phase 3 is split: the
   generic editor now, erf-anchored layouts after Phase 2.
4. **The nested Bedouin in v1.** gis-placement-spec §F.3 says tent packing "MUST
   NOT be scheduled before the layout editor has been used by a real camp". The
   epic puts nested areas in v1. **Recommended: include manual nesting in v1**:
   drag tents, poles and walkways under a shade structure using the same tools.
   This is the same mechanism, not a second tool. Keep **auto-arrange
   (`TENT-011`) and capacity estimation (`TENT-015`) out**. Those are the parts
   §F.3 warns about.
5. **Who edits.** **Recommended:** the structural lead and co-leads, plus
   members holding a new camp privilege **`manage_layout`** ("Edit the camp
   layout"). The person who plans the camp's build is often not the camp lead.
   Adding a privilege changes `ProjectPermissionKey` in `@quagga/types` (the
   permissions column is jsonb), so no migration is needed. Alternative: leads
   and co-leads only, with no privilege yet, as in the shifts spec.
6. **Who sees.** **Recommended: every current member of the camp, read-only.**
   They need to know where their tent and the kitchen go. Strangers, members of
   other camps and former members get the camp's 404. The layout is never public:
   it shows where people sleep and where the gas and generators are
   (gis-placement-spec §H). Alternative: the same audience as the registration
   (leads and co-leads only, `canViewCampRegistration`).
7. **Tent ownership (`LAYOUT-040`).** **Recommended: free-text label only in v1**
   ("Alice's tent"). No link to a member. Linking a tent to a membership would
   show campmate names to every member, which is a roster disclosure that
   `canViewCampRoster` does not grant today. A member-linked "my tent" feature
   waits for its own privacy decision.
8. **What owns a layout.** **Recommended:** one layout per **registration**
   (`registration_id`, unique), as gis-placement-spec §D.2 sketches. The camp-page
   tile opens it, and its empty state links to "Start your registration" when no
   registration exists for the edition. Alternative: key on (camp, edition), so a
   camp that never registers with AfrikaBurn can still plan.
9. **Editing after submission.** The registration wizard is read-only outside
   `draft` and `changes_requested`, but camps keep planning tents until the burn.
   **Recommended:** the layout is a working document. Editors can change it at any
   time in the edition. **Submitting the registration pins a snapshot**, and that
   pinned version is what the org sees. Later edits do not reach the org until
   the camp resubmits through the existing `changes_requested` loop. There is no
   separate "send updated layout" flow in v1 (`ERF-023`); that belongs to v2.
10. **What the org sees.** **Recommended:** a read-only plan of the pinned
    snapshot on the console's registration detail, under section 4 (Size &
    logistics). Reviewers comment through the existing `section_reviews` thread
    on `size_logistics`, so there is no new review machine and no new enum value.
    The audience is whoever can already read the registration in the console. In
    the placement CSV, add only the plot dimensions and area, never the layout
    itself.
11. **Area dimensions (`s4_area_dimensions`).** This is a free-text question in
    Form 2. **Recommended (derive over ask):** when a layout exists, show the
    plot's size and area beside the field as "From your layout: 40 m × 30 m,
    1,200 m²" and make the free-text field optional. The column is never written
    automatically.
12. **Carry-forward.** The epic says "carry forward to next edition as a draft".
    The R1 carry-forward rule (App Spec §14) says "everything Form 2 asks starts
    empty every year … and the layout diagram". **Recommended:** the layout is not
    a Form 2 answer, so it carries. Offer "Start from last year's layout" as a
    one-click copy into the new registration's layout. Never copy it
    automatically, and never mark section 4 complete because of it.
13. **Mobile.** **Recommended: 360 is view-only.** It shows the plan with
    pan/pinch-zoom, the object list, and an "Edit on a larger screen" note.
    Editing needs a viewport of 768 px or wider; Konva's touch support makes
    tablets usable.
14. **Validation is advisory.** **Recommended:** warnings never block saving or
    submitting (gis-placement-spec §E.5). Only malformed or oversized documents
    are refused.
15. **Object defaults (U9).** No AfrikaBurn source gives object sizes or
    setbacks. **Recommended:** the catalogue ships with defaults clearly marked as
    estimates in the palette ("estimated, check your own"). DPW sizes replace them
    when AfrikaBurn publishes them.
16. **Export.** **Recommended:** a PNG download (client-side) and a printable
    page (the SVG plan with a scale bar and dimensions, for no connectivity on
    site). JSON export is left out of v1: the only consumer is AfrikaBurn's GIS
    merge, and the format for that is unknown until Phase 0.

## Model

The canonical document is ours. No Konva or GeoJSON types reach it. All lengths
are **metres** and all angles **degrees**, in **plot-local coordinates**: origin at
the frontage-left corner, x along the frontage, y into the depth, right-handed
(gis-placement-spec §B.4). That frame is the "erf-local" frame, which is why a
GIS outline drops in later.

```ts
type Vec = readonly [x: number, y: number]; // metres

type LayoutArea = {
  // The outline. v1 always writes { kind: "rect" }; GIS later writes "polygon".
  boundary:
    | { kind: "rect"; width: number; depth: number }
    | { kind: "polygon"; ring: Vec[]; source: "gis"; sourceRef: string };
  frontageEdge?: 0;                 // index of the frontage edge (rect: the x-axis edge)
  objects: LayoutObject[];
};

type LayoutObject = {
  id: string;                       // uuid, stable across edits
  catalogKey: string;               // edition-scoped catalogue entry, e.g. "bedouin", "tent-2p"
  shape: "rect" | "circle";         // v1; a free polygon is in "Not built"
  centre: Vec;                      // in the parent area's metres
  width: number; length: number;    // LAYOUT-032/033 (rect)
  diameter?: number;                // LAYOUT-034 (circle)
  rotationDeg: number;              // LAYOUT-035, 0 ≤ r < 360
  clearanceM: number;               // LAYOUT-036, halo
  safetyM: number;                  // LAYOUT-037, halo
  label?: string;                   // LAYOUT-038 (and tent "ownership" text, decision 7)
  notes?: string;                   // LAYOUT-039
  visibility: "public" | "private"; // LAYOUT-043
  child?: LayoutArea;               // shade structures only; nesting depth 1
};

type LayoutDocument = { schemaVersion: 1; plot: LayoutArea };
```

- `camp_layouts`: `registration_id` (unique FK, the owner), `document` (jsonb
  `LayoutDocument`), `version` (int, compare-and-set), `updated_by`,
  `updated_at`.
- `camp_layout_snapshots` (append-only): `layout_id`, `version`, `document`,
  `pinned_at`, `pinned_by`, and the registration submission it belongs to.
  The org reads the latest of these.
- **Catalogue** (`@quagga/core` `layout-catalog.ts`): edition-scoped data keyed
  by year, the same pattern as `placement-zones.ts`. Each entry has a key, label,
  icon, shape, default sizes, clearance and safety, `nestable` (Bedouin, stretch
  tent, dome, shade structure, gazebo), and `estimate: true` until AfrikaBurn
  confirms the sizes. v1 covers `LAYOUT-001`–`031` and the tents in
  `TENT-016`–`023`. Inside a nested area it also offers support poles
  (`TENT-003`), walkways (`TENT-005`, `TENT-013`), entrances (`TENT-006`) and
  accessible spaces (`TENT-014`) as ordinary objects.
- A nested area's boundary defaults to its parent object's footprint, which is
  the usable covered area (`TENT-002`). It is editable, because the covered area
  is smaller than the tent's outer footprint, which includes guy ropes.
- Schema changes come from `schema.ts` plus `db:generate`. Nothing is
  hand-written.

## Rules (`@quagga/core` `camp-layout.ts`, plus the geometry module from decision 2, enforced server-side)

- **Access:** `canEditCampLayout(role, permissions)` returns true for lead or
  admin, or for `manage_layout`. `canViewCampLayout(isCurrentMember)`. The org's
  read rides on the existing registration-read capability. Actions answer "Camp
  not found." to non-members, the same answer as a slug that does not exist.
- **Saves are compare-and-set** on `version`. A stale save is refused with "This
  layout changed since you opened it", and the client reloads. Undo and redo are
  client-side only.
- **Zod on every write.** It refuses: an unknown `schemaVersion`; non-finite
  numbers; sizes outside 0.1–500 m; a plot larger than 500 m × 500 m; more than
  400 objects in total; nesting deeper than 1; a `child` on a catalogue entry
  that is not `nestable`; text over its length cap; and a document over about
  256 kB.
- **Snapping** to 0.5 m and 15° is done in metres by pure functions, so it is
  the same at every zoom level and testable.
- **Warnings** are advisory pure functions that return
  `{ code, severity: "warning", message, objectIds }`. Each message names the
  measurement:
  - **Overlap** (`TENT-024`): footprints intersect. A separate softer note
    covers clearance halos that intersect.
  - **Out of bounds**: an object leaves its area. In a nested area this is
    `TENT-029`, "exceeds the covered area".
  - **Pathway or lane blocked** (`TENT-025`): any object other than a pathway
    intersects a pathway, emergency lane or fire break object (`LAYOUT-027`–`029`).
  - **On a support pole** (`TENT-026`): a tent footprint contains a pole.
  - **Rigging zone** (`TENT-027`): an object sits inside a shade structure's
    clearance halo outside its covered area.
  - **Frontage obstructed**: a vehicle or private tent within N m of the frontage
    edge (AfrikaBurn's "no cars or tents up front" rule, `theme-camps-guide.md`).
    N is an estimate.
  - **Plot summary** (`ERF-002`): dimensions, area, and covered area used, shown
    rather than warned.
- Geometry is rotated rectangles and circles: SAT for overlap, plus
  point-in-polygon against the boundary ring. It handles a polygon boundary from
  day one, so the GIS outline needs no new code. Unit tests cover each warning,
  with a fixture that crosses the threshold in both directions.
- **No new privacy class.** The layout holds no personal data beyond the
  free-text labels editors write. It never appears in a public projection,
  directory or export other than the plot size (decision 10).
- **Env-less boot:** the editor needs no environment variables. Image export is
  client-side. Nothing new talks to Blob.

## Surfaces

- `/camps/[slug]` — the "Layout · Exploring" hint tile becomes a real tile for
  members: plot size, object count, last edited, a link to the layout.
- `/camps/[slug]/layout` — editors get the editor; members get the read-only
  plan with the object list. At 360, everyone gets the read-only view
  (decision 13).
  - Editor: a palette (searchable, grouped: shelter, vehicles, infrastructure,
    safety, areas), the canvas with pan and zoom, live metre readouts on the
    handles while resizing, the plot's size and area, a warnings panel that
    selects the offending objects, an inspector with numeric inputs, undo/redo,
    and save state.
  - Opening a shade structure: the same editor with that object's area as the
    root, a breadcrumb back to "Whole camp", and the parent outline ghosted for
    context.
- `/camps/[slug]/layout/print` — the printable plan: scale bar, dimensions,
  legend, object list.
- Registration wizard, section 4 — "Draw your layout" next to the uploads, the
  "From your layout" dimensions (decision 11), and "Start from last year's
  layout" (decision 12).
- Org console, registration detail, section 4 — the read-only plan of the
  pinned snapshot, the existing section review thread, and the plot size in the
  placement CSV.
- Design first: frames for the editor, the palette, the nested Bedouin view, the
  member view and the console view, each desktop plus a 360 pair. The three
  parked "Camp Plot v2" frames (`cyMi6`, `CwVWw`, `OLb9g`) are the starting point
  and should be reviewed before new frames are drawn.

## Not built

- **The real plot shape from GIS** (v2). It is phase-gated through
  gis-placement-spec Phase 0 onward, and each phase needs its own go-ahead. Until
  then, build against a local sample fixture.
- **Erf anchoring, neighbours, fit-checking against an erf** (`ERF-001`,
  `ERF-003`–`011`), the suggestion engine (`ERF-012`–`017`), and the propose and
  approve loop (`ERF-018`–`023`: the camp's answer to a layout AfrikaBurn
  proposes). Org comments on section 4 are the registration's section-review
  thread, not `ERF-021`.
- **Auto-arrange and capacity estimate** (`TENT-011`, `TENT-015`), and spacing as
  a rule rather than a halo (`TENT-012`). Emergency access adequacy
  (`TENT-028`) beyond "a walkway is blocked".
- **Free polygons and lines** drawn by the camp, power and water figures on
  objects (`LAYOUT-041`, `042`), and totals against what the camp ordered.
- **Member-linked tent ownership** (decision 7), and real-time co-editing.
- **JSON or GeoJSON export, and any write-back into AfrikaBurn's GIS.**
  Submissions go to AfrikaBurn for manual merge.
- AI auto-layout. The working group rejected it (Decision 011).
