# Frame review process — rigorous, repeatable, not screenshot-based

Screenshots of full frames are thumbnails: on a 3,000px-tall mobile frame, a
one-letter-per-line text column is literally invisible. Three visual QA passes missed
defects that coordinate math then found in one run (145 of them). So reviews here are
**measurement-first**; screenshots are a narrow, final step with strict rules.

## The tooling (this directory)

- `penctl.py` — raw JSONRPC client to the Pen bridge (works even when the MCP session
  tools are flaky; requires the Pen app running with the doc open).
- `audit.py` — the checker. Modes:
  - `python3 audit.py --sections <frameId>` → the frame's **component manifest**
    (every node: type, name, which library component it instances, disabled state, size)
  - `python3 audit.py <frameId>` → all checks for one frame
  - `python3 audit.py --all` → whole document (the number to drive to zero)
- `whitelist.json` — verified-intentional exceptions, each with a WHY. An entry
  without a reason is invalid. Never whitelist to make a number go green.

## The per-frame review, step by step

**1. Decompose.** `audit.py --sections <frameId>`. Read the manifest. You now know
what is actually IN the frame: its sections, which library components it instances
(vs hand-drawn), what is disabled, and every text node. If the manifest surprises you
(hand-drawn copies of library components, stale disabled blocks, unexpected sections),
that is itself a finding.

**2. Measure.** `audit.py <frameId>`. Zero tolerance on `[DEFECT]` lines:
overflow, overlap, letter-stack, forbidden content (payments!), raw hex, tiny fonts.
`[WARN]`/`[STYLE]`/`[SCROLL?]`/`[CLIPPED]` lines get judged, not ignored: each one is
either fixed or whitelisted-with-reason.

**3. Fix by property, verify by measurement.** Standard cures (history says these
cover nearly everything):
- auto-width text in a fill column → `textGrowth: fixed-width` + `width: fill_container`
- fixed desktop widths (tracks, charts, tables) in narrow cards → `fill_container`
- space_between rows whose two fit-content sides can't fit → stack vertical, or make
  one side `fill_container`
- a fixed-width sibling starving a column (QR, chart, image) → stack the row vertical
- never `Move()`; restructure by Insert-new + disable/Delete-old
Re-run `audit.py <frameId>` after fixing. The finding must be GONE from the output —
"looks fixed" doesn't count.

**4. Targeted visual pass — only after step 3 is clean.** Math can't see everything:
missing image fills, contrast, misaligned intent, wrong copy. Rules:
- screenshot **sections** (cards), never whole frames taller than ~1100px
- you must be able to READ the text in the screenshot; if not, zoom deeper
- freshly-edited nodes render blank/stale — that's cache lag, not a defect; verify
  those by geometry and move on (one export attempt max)
- translucent nodes screenshotted in isolation composite on white and look ghostly —
  verify in situ via the parent

**5. Cross-frame invariants** (run `--all` when touching shared things):
- library components must never contain annotation text (the CHECKED/EMPTY/SELECTED
  tags caused ~60 defects across 20 frames before being disabled at source)
- content edits go to BOTH of a desktop/mobile pair
- canonical numbers must agree across frames (47 camps, 342 burners, edition dates)
- the never-payments law: `[CONTENT] FORBIDDEN-TEXT` findings are always defects
  outside supplier-deposit "tracked only, never processed" wording

## Known measurement gotchas

- The layout snapshot reports **disabled nodes' ghost geometry**. audit.py filters
  these using live props (source `enabled:false` AND instance descendants overrides),
  so a fresh run has no ghost false-positives. If you see a finding on a node you
  believe is hidden, check the manifest's `[disabled]` marker before "fixing" it.
- `snapshot_layout` ignores nodeId scoping — audit.py always snapshots the whole doc.
- `batch_get` elides deep children on big requests — audit.py crawls in 15-id chunks.
- Phantom "+50px partially clipped" on fit-content bodies and
  "fill_container not inside flexbox" on disabled nodes: known tool noise.
- **A brand-new frame does not settle.** Freshly created nodes come back from
  `snapshot_layout` with a uniform **+50px y bias** (and `space_between` children
  pinned to the container's right edge), and `get_screenshot` / `export_nodes`
  render them blank — so audit.py reports *hundreds* of phantom V-OVERFLOW and
  OVERLAP defects on a frame that is actually fine. Waiting, resizing, toggling
  layout/theme, Move, forcing a `batch_design` error, screenshotting and
  exporting all fail to clear it.
  **The fix: Copy the finished frame to a scratch position** — the copy lays out
  correctly and audits truthfully — **then delete the original and Update the
  copy's x/y/name.** Expect the surviving frame to carry a different node id
  than the one you built; update any notes that cite it.
- **Never delete children to restructure a container.** Removing children from an
  existing frame genuinely corrupts that frame's layout in this app (an in-place
  rebuild of one card left it rendering as an empty coloured box — not a
  measurement artefact, a real corruption). The "Insert-new + disable/Delete-old"
  advice above is for swapping a *leaf*; when a container needs restructuring,
  rebuild the whole frame and swap it in via the Copy trick.
- **The canvas is not saved by the MCP tools.** Everything an agent draws lives in
  the Pen app's memory until the app itself writes the file. `git status` showing
  `design/ab-initial-app.pen` unchanged after a drawing session does **not** mean
  nothing happened — it means nothing has been persisted yet. Confirm with
  `md5sum` against `git show HEAD:design/ab-initial-app.pen` and ask the user to
  save before treating any design work as done.

## Definition of done for any design change

1. `audit.py <touched frames>` → zero defects, warnings dispositioned
2. section screenshots of changed areas read correctly
3. desktop+mobile pair both updated
4. `audit.py --all` clean before telling anyone "the canvas is clean"
