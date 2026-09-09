# QGIS site map — integration investigation

| Field                  | Value                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **Category**           | Planning                                                                                                 |
| **Doc status**         | Draft                                                                                                    |
| **Normative language** | Descriptive only — this document reports findings and options; it does not itself impose requirements    |
| **Requirement IDs**    | Partial — `LAYOUT-*`, `ERF-*`, `REG-029`, `REG-030`. Best-effort, not audited; nothing here is built yet |
| **Owner / Updated**    | Repo maintainers, 2026-09-09                                                                             |

AfrikaBurn is reportedly building a QGIS map "for managing the layouts." This
document works out what that would mean for this codebase: what QGIS can hand
us, what each hand-off shape unlocks, what it costs against the rules this repo
already runs on, and which questions have to be answered before any code is
worth writing.

**The short version.** This is the named blocker moving. `roadmap.md`'s blocker
table lists _"Site map / erf data format — Placement candidate work — AB"_, and
[`technical-spec.md`](technical-spec.md) §11/§13 park the layout tool and erf
placement as ⚠️ **blocked, and not on code**: _"A scaled tool needs to know real
dimensions… That data does not exist in any structured form; the official map is
a PDF."_ A QGIS project is structured geo data. If AfrikaBurn's map is
**georeferenced and scaled**, the blocker is gone and §11/§13 become ordinary
engineering. If it is a hand-drawn sketch in an arbitrary coordinate system, we
have a nicer-looking PDF and the blocker stands. **That single distinction
decides everything below**, and it is question 1 in §7.

There is also a second finding worth as much as the first: the cheapest useful
integration runs **outbound**, not inbound — feeding registration data _into_
their QGIS rather than rebuilding a map _in_ our apps. See §6.

---

## 1. First, disambiguate "layouts"

"QGIS map for managing the layouts" has two readings, and they are different
projects:

| Reading                                                                                                                      | What it is                                                                                 | What it would mean for us                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Camp layouts / erf placement** — erven, roads, zones, who sits where                                                   | A GIS dataset of Tankwa Town: vector layers for zones, roads, erf polygons, allocations    | The unblocking event for §11/§13. Real data, real integration surface.                                                           |
| **(b) QGIS _Print Layouts_** — QGIS's own term for its map-composer feature, which produces the printable PDF/PNG map sheets | A better production pipeline for the same yearly map artefact AfrikaBurn already publishes | Almost nothing changes for us. We would still be handed a PDF, just a more reliably produced one. §11's objection stands intact. |

Reading (b) is a real possibility, not a pedantic one: "layout" is a QGIS
feature name, and a placement team adopting QGIS very plausibly starts by moving
map _production_ off whatever it uses today. Ask before designing.

**The rest of this document assumes reading (a)**, and notes where the answer to
question 1 (§7) collapses it back to (b) in practice.

## 2. What QGIS can actually hand us

Five hand-off shapes, ranked by how much they unlock per unit of effort and
operational risk. "Ops owner" matters: this repo's boot law
([`AGENTS.md`](../AGENTS.md) rule 4) means no external service may be load-bearing.

| #     | Shape                                                                                | What we receive                                                                                  | What it unlocks                                                                                   | Ops cost / owner                                                                                                      |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **1** | **GeoPackage or GeoJSON export, per edition** _(recommended start)_                  | One file per edition holding zone / road / erf layers with real geometry, attributes and an SRID | Everything in §5 stages 1–3: real zone list, erf index with dimensions, "your erf" views          | Lowest. A file lands in Blob or the repo; we own it. No uptime dependency, no live coupling.                          |
| **2** | **Our Neon Postgres as a PostGIS layer** — AfrikaBurn's QGIS connects to it directly | Two-way: their QGIS edits geometry we store                                                      | The same, plus allocations edited in QGIS appearing in the portal with no export step             | High. Direct DB credentials for an external tool, our frozen schema edited by a GUI, and PostGIS (§4). See §8 risk 2. |
| **3** | **QGIS Server** — WMS / WFS / OGC API Features, hosted by AfrikaBurn                 | Live layers over HTTP; OGC API Features lands in QGIS Server 3.10+ and serves GeoJSON            | Live data without file hand-offs                                                                  | Medium, and **not ours**: QGIS Server is an FCGI/C++ service that does not run on Vercel. AfrikaBurn must host it.    |
| **4** | **qgis2web / static web export**                                                     | A self-contained Leaflet or OpenLayers page                                                      | A map you can link to. Not data — we cannot query it, join it to a camp, or test a fit against it | Low, and low value for us. Fine as a public "here is the site" page.                                                  |
| **5** | **Print Layout export → PDF / GeoPDF / SVG**                                         | The artefact we already get                                                                      | Nothing new, unless it is a **GeoPDF** carrying real coordinates — then it is a weaker option 1   | Zero. This is the status quo §11 already rejected as a foundation.                                                    |

Notes on the two that need them:

- **Option 1 detail.** GeoPackage (`.gpkg`) is the format to ask for, not
  Shapefile: one file, no 10-character column-name limit, multiple layers, and
  an SRID recorded properly. It is a SQLite database, so treat it as an opaque
  binary in transit — never parse it in a browser. GeoJSON is the fallback
  (always EPSG:4326 by spec, human-readable, diffable in git, and one file per
  layer).
- **Option 3 detail.** Even with QGIS Server available, we should **import
  snapshots rather than proxy live requests.** A per-edition import keeps the
  boot law intact (their downtime cannot take our pages down), makes the data
  reviewable before it goes in front of camps, and gives us something stable to
  test against. Site geometry changes a few times a season, not a few times a
  minute.

## 3. Where this touches the code today

Everything a first integration would touch already exists and is small:

| Surface                                                                                                  | Today                                                                                                                                                                                             | With QGIS zone/erf data                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/placement-zones.ts`                                                                   | A **hardcoded** seven-zone list keyed by edition year. Its own header says zones _"change year to year and must be configurable per edition"_ and that the frozen schema has no per-edition table | This file is a placeholder for exactly the data a QGIS zone layer contains. Replacing its contents with an import is the smallest real win.  |
| `apps/web/components/registration/registration-wizard.tsx:152` → `PlacementSelect` (`field-kit.tsx:499`) | Renders that list; the choice is stored as free text                                                                                                                                              | Same component, same columns, real options. **No migration** — see the next row.                                                             |
| `registrations.s5_placement_first_choice` / `_second_choice` (`packages/db/src/schema.ts:1120-1121`)     | `text` columns holding the zone's human-readable `value` verbatim                                                                                                                                 | Keep the shape. An imported zone keeps a stable name; the column keeps storing it. Stage 1 needs no schema change at all.                    |
| `registrations.s4_layout_upload_urls` (`schema.ts:1112`)                                                 | Up to four uploaded diagram files (jsonb array of URLs)                                                                                                                                           | Unchanged until a scaled canvas exists. This is the honest stand-in §11 describes.                                                           |
| `wrangler_assignments` (`schema.ts:1190`)                                                                | Wrangler ⇄ camp × edition, unique per pair                                                                                                                                                        | The actor for an erf proposal already exists. No new role, no new table for _who_ proposes.                                                  |
| `section_reviews` + the registration review loop                                                         | Per-section, two-way, open/resolved, audited                                                                                                                                                      | §13's propose → approve/reject/comment/revise loop (`ERF-019`–`ERF-023`) is **this pattern applied to a different artefact**, as §13 says.   |
| `/camps/[slug]` disabled hint tiles ("Placement & Art grants — entitlement, process TBC")                | The current honest answer                                                                                                                                                                         | Stays as the degraded state when an edition has no map data. The boot law requires exactly this.                                             |
| `apps/web/app/api/registration/upload/route.ts:16`, `apps/{web,org}/app/api/blob/upload/route.ts`        | Content-type allowlists (images; org has `DOC_TYPES`/`IMAGE_TYPES`)                                                                                                                               | `.gpkg` / `.geojson` / `.qgz` are in **no** allowlist. Accepting a map export means a new, deliberately narrow policy entry — org-side only. |
| `docs/sdk/` (Draft, unbuilt) — 49 closed scope strings, `/v1`                                            | Specified, not built                                                                                                                                                                              | The outbound direction in §6 rides this. A `placement` read scope and a GeoJSON response is a small addition to an existing design.          |

Nothing here needs a new app. The org console gains a page; `@quagga/core`
gains a pure module; `apps/web` gains a read-only view.

## 4. The geometry-storage decision, and why PostGIS probably loses at first

This is the one genuinely load-bearing technical choice, and this repo has
already made the same call twice in the other direction.

**Verified precedent: this codebase runs on zero Postgres extensions.**

- `pgcrypto` — the schema comments say "pgcrypto-encrypted", but
  `packages/db/src/crypto.ts:12-13` states plainly that Node's built-in
  AES-256-GCM is used instead, _"same threat model."_ No extension.
- `pg_trgm` — the camp-name dedupe warns on _"trigram similarity ≥ 0.55"_
  (`apps/web/lib/groups-store.ts:767`), and `trigramSimilarity` is a pure
  function in `@quagga/core`, computed in JS over rows fetched by a plain
  `select`. No extension.

**What PostGIS would cost.** It is available — Neon supports `postgis`, plus
`postgis_raster`, `pgrouting`, `h3_postgis` and SFCGAL — but:

- Drizzle's `geometry` type predefines **`point` only**; erf polygons need a
  `customType` or raw SQL, so the schema's single-source-of-truth property gets
  a hole in it.
- Drizzle does not create the extension. Its documented path is
  `drizzle-kit generate --custom`, which emits an empty migration you then fill
  with `CREATE EXTENSION postgis;`. There is precedent for hand-authored SQL in
  the tree (`0027_decision_reason_invariant.sql`), and it does not violate the
  append-only law ([`AGENTS.md`](../AGENTS.md) hard rules 1–2 — a _new_
  migration is fine, editing an existing one never is), but "generated, never
  hand-edited" ([`build-spec.md`](build-spec.md) hard constraint 5) is close
  enough to the line that it is a maintainer's call, not a feature branch's.
  Two further checks before anyone commits to it: it would be the first
  extension this database carries, applied automatically at deploy by the
  advisory-locked runner; and `CREATE EXTENSION` needs privileges the app's Neon
  role may not have.
- The schema is **frozen** ([`build-spec.md`](build-spec.md) hard constraint 5,
  and the "Schema (frozen)" heading): feature work MUST NOT add or alter tables. Any erf/zone table is a maintainer decision, and
  `.github/CODEOWNERS` puts migrations behind review regardless.

**The cheaper option that fits the existing grain.** Store the imported geometry
as **GeoJSON in `jsonb`** (the schema already uses `jsonb` widely) and put the
geometry math in `@quagga/core` as pure functions — point-in-polygon, polygon
area, bounding box, rectangle-overlap, clearance rings. That keeps
`@quagga/core` free of `@quagga/db` (the one-directional rule in
[`architecture.md`](architecture.md)), keeps it unit-testable with no database,
and matches how trigram similarity is already done.

The scale argument settles it: Tankwa Town is on the order of **hundreds of
erven**, not millions of features. Spatial indexes and `ST_*` queries earn their
keep at a scale we are nowhere near. PostGIS becomes the right answer when we
need real spatial queries at volume, raster analysis, or QGIS writing directly
to our tables (option 2) — and that is a decision to revisit then, with the data
in hand, not now.

**Rendering.** No geo dependency exists in any workspace today. For read-only
views of a few hundred polygons, inline SVG from the imported GeoJSON is enough
and adds nothing to the bundle. A tile-based library (MapLibre) only becomes
necessary if we need basemaps, satellite imagery or pan/zoom over large rasters
— and it brings a WebGL dependency and a tile-hosting question with it.

## 5. A staged path, each stage shippable alone

Deliberately ordered so no stage requires the next, and so the first two need no
schema change.

**Stage 0 — no code.** Get the answers in §7 and **one sample export** of
whatever exists today, even a draft. One `.gpkg` tells us more than any meeting:
CRS, layer names, attribute columns, whether erf polygons carry dimensions, and
whether the geometry is surveyed or sketched.

**Stage 1 — zones become real.** Import the zone layer per edition; replace the
hardcoded list in `placement-zones.ts` with imported names, blurbs and geometry;
add an org-console viewer that renders the zones and lists them. Registration
gains real options and a map to look at while choosing. No migration, no new
table, existing columns.

**Stage 2 — the erf index.** Import erf polygons with their identifiers and
dimensions. This is what makes roadmap R1's _"Staff-assigned ERFs + camp codes
on profiles"_ more than a text field — and note that R1 item is **not blocked**
either way; QGIS upgrades it from a string to an object with a real footprint.
Unblocks container booking and the water-supplier sign-up, both of which need a
location, neither of which needs a layout tool.

**Stage 3 — camp-facing "your erf", and the loop.** A read-only view: your erf,
its dimensions, its road and public frontage, your neighbours. Then the
propose → approve/reject/comment/revise loop (`ERF-019`–`ERF-023`) on the
`section_reviews` pattern, with the wrangler from `wrangler_assignments` as the
proposer. This is a reuse job, not a new subsystem — §13 says so already.

**Stage 4 — the scaled canvas.** `LAYOUT-001`–`043` and `ERF-001`–`018`: the
object library (tents, containers, generators, water tanks, each with clearance
and safety areas) on a canvas scaled to the real erf. Ships **only** if the
answer to question 1 is "surveyed and georeferenced." §11's warning is the
acceptance criterion: a tool that lets camps place objects to a false scale is
worse than a photograph of a sketch. The overlap **warnings** are worth shipping
long before any automatic-arrangement optimiser (§12).

**One rule across all stages.** QGIS stays the **system of record for the
site**; the portal never writes geometry back into their project. If proposed
allocations ever need to reach QGIS, they go as an export AfrikaBurn imports, or
a table they read — not a two-way sync. Two systems both authoritative over the
same polygons is the container-vs-Quicket mistake in a new costume.

## 6. The inversion: feed their QGIS instead

The highest-leverage integration may not be a map in our apps at all.

The placement team's real problem is allocating camps to erven while weighing
size, sound level, interactivity, MOOP record and neighbour requests. Every one
of those attributes lives in this database already — `registrations` §4 size and
§5 sound/placement columns, supplier declarations, the review history. Today
that reaches a wrangler as a spreadsheet export (`roadmap.md` R1: _"export for
placement"_).

If instead we expose a **read-only GeoJSON-or-tabular endpoint on `/v1`**, their
QGIS can load it as a live layer and the placement team does the allocation in
the tool they are already choosing, against current registration data. QGIS
supports this natively: it loads vector layers from an HTTP(S) URL, and its
authentication manager has an **API Header** method that attaches an
`Authorization` header to those requests — so an integrator key works without
any plugin. The `docs/sdk/` design already provides the machinery (closed scope
strings, a server-issued capability manifest, zod output schemas as the PII
stripper); this needs a `placement` read scope and one response schema, not a
new architecture.

**Why this is attractive:** it is small, it is one-directional, it needs no
geometry storage, no PostGIS, no rendering library and no schema change — and it
makes the portal useful to the placement team _this season_, whatever the map
turns out to be. It also constrains the PII surface tightly: erf allocation
needs camp name, size, sound level and preferences, and none of the contact or
identity fields the SDK design already hard-locks.

**The one caution:** attribute data leaving the platform into a desktop tool is
a POPIA surface. Keep the field list minimal and explicit in the response
schema, and never include the hard-locked or safety-visible fields
([`accounts-security-spec.md`](accounts-security-spec.md)).

## 7. Questions for AfrikaBurn

In priority order. The first three decide whether any of §5 is real.

1. **Is the map georeferenced and to scale, and in what CRS?** A real projected
   system (e.g. EPSG:32734, UTM 34S, which is where Tankwa Town sits — or
   EPSG:4326 lat/long) with surveyed geometry unblocks §11. A drawing in an
   arbitrary local CRS does not, and we should say so plainly rather than build
   on it.
2. **Where do the erf dimensions come from?** Survey, GPS trace, or drawn by
   eye on a satellite image? This is the accuracy question §11 turns on, and it
   is separate from question 1 — a georeferenced project can still contain
   hand-drawn polygons.
3. **Is this reading (a) or reading (b) in §1** — a GIS dataset of the site, or
   QGIS Print Layouts producing the yearly PDF?
4. **What can you hand us, and how often?** Ranked from §2: a per-edition
   GeoPackage export (best), GeoJSON per layer, a QGIS Server endpoint you host,
   or a PDF. Who exports it, and when in the season?
5. **Are erf identifiers stable within an edition, and across editions?** The
   yearly re-layout means an "erf 42" that moves between years is a different
   place with the same name — which changes how we key everything downstream.
6. **What attributes does each erf carry?** Dimensions, road frontage, public
   frontage, zone, sound band, allocation status, neighbours?
7. **Would a live layer of registration data in QGIS be useful** (§6)? If yes,
   which fields does the placement team actually need? Naming them is what keeps
   the endpoint minimal.
8. **Who owns the map, and what is the licence?** We need to know what may be
   shown publicly, to registered camps only, or to staff only, before any of it
   renders in a browser.
9. **How does allocation reach camps today**, and would AfrikaBurn want that to
   run through the portal, or stay in QGIS with the portal only displaying the
   result?

## 8. Risks

| #     | Risk                                                                                                                                                                  | Mitigation                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **False precision.** A pretty scaled canvas built on hand-drawn polygons tells camps their gazebo fits when it does not. This is §11's stated objection, unchanged.   | Question 1 gates stage 4, not stages 1–3. Render provenance and accuracy in the UI; where accuracy is unknown, say so on the page.      |
| **2** | **Option 2 (QGIS → our Neon).** External DB credentials, a GUI editing a frozen schema, migrations racing a desktop tool.                                             | Don't, at least not into the app's database. If it ever happens, it is a separate database or schema that we import from, not `public`. |
| **3** | **Live coupling to QGIS Server.** Their downtime becomes our broken page, against the boot law.                                                                       | Import snapshots per edition (§2 note). Never proxy on the request path.                                                                |
| **4** | **Yearly re-layout invalidating stored geometry.** The layout changes every year — `roadmap.md` says so, and it is why placement is deferred.                         | Key every imported layer to `edition_id`, exactly as `placement-zones.ts` already keys zones to a year. Never a single global map.      |
| **5** | **Upload surface.** `.qgz` is a zip and `.gpkg` is a SQLite database. Accepting either widens what a public endpoint will store.                                      | Org-console-only upload, narrow allowlist, size cap, no server-side parsing of untrusted archives, and never parse in the browser.      |
| **6** | **Publishing camp locations.** An erf map showing who is where is a disclosure decision, not a rendering one.                                                         | Question 8 before anything renders publicly. Default to staff-only, then registered-camp-own-erf, then public.                          |
| **7** | **Scope creep into a GIS.** §11's object library is _"largely a data-entry exercise"_; the canvas underneath is the blocked part. It is easy to start building a GIS. | Stages 1–3 deliver value with no canvas. Stage 4 stays parked until questions 1–2 are answered on paper.                                |

## 9. Recommendation

1. **Ask §7's questions now**, and ask for one sample export. Nothing else is
   worth starting first, and the export answers more than the questions do.
2. **Do §6 in parallel** — the outbound registration layer for their QGIS. It
   is small, one-directional, useful this season regardless of the answers, and
   it rides a design (`docs/sdk/`) that already exists.
3. **Hold stages 1–3 until the sample export is in hand**, then do them in
   order. They need no schema change until stage 2.
4. **Leave stage 4 parked**, and leave `roadmap.md`'s "Placement & layout
   tooling — explicitly deferred" entry exactly as it is until questions 1 and 2
   come back answered. The condition it names — _"until AB's map process
   changes"_ — is precisely what a georeferenced QGIS project would satisfy, and
   nothing less than that does.
5. **Default to GeoJSON-in-`jsonb` plus pure functions in `@quagga/core`**, not
   PostGIS, for the first three stages. Revisit with data in hand.

---

### Sources for the external claims above

Every claim about this repository carries a file path inline. The external ones:

- QGIS Server OGC API Features (GeoJSON output, landed 3.10):
  [docs.qgis.org — OGC API Features](https://docs.qgis.org/3.40/en/docs/server_manual/services/ogcapif.html)
- QGIS authentication manager, API Header method:
  [docs.qgis.org — Authentication System Overview](https://docs.qgis.org/3.44/en/docs/user_manual/auth_system/auth_overview.html)
- Neon PostGIS availability and related extensions:
  [Neon docs — the postgis extension](https://neon.com/docs/extensions/postgis),
  [PostGIS-related extensions](https://neon.com/docs/extensions/postgis-related-extensions)
- Drizzle `geometry` (point only) and the `--custom` migration for
  `CREATE EXTENSION postgis`:
  [Drizzle docs — PostgreSQL extensions](https://orm.drizzle.team/docs/extensions/pg),
  [PostGIS geometry point guide](https://orm.drizzle.team/docs/guides/postgis-geometry-point)
