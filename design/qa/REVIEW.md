# Frame review process — rigorous, repeatable, not screenshot-based

Screenshots of full frames are thumbnails: on a 3,000px-tall mobile frame, a
one-letter-per-line text column is literally invisible. Three visual QA passes missed
defects that coordinate math then found in one run (145 of them). So reviews here are
**measurement-first**; screenshots are a narrow, final step with strict rules.

## The tooling (this directory)

- `penctl.py` — raw JSONRPC client to the Pen bridge. **This is transport for
  `audit.py`, not a tool you should reach for directly.** For ad-hoc inspection —
  reading a frame's strings, checking one node's props — use the `mcp__pencil__*`
  tools, which is what `design/pen-lessons.md` now recommends; the bridge exists
  because `audit.py` is a python process and cannot call those.
  Requires the Pen app running with the doc open. It locates the bridge binary
  itself, guessing a standard Pencil install per platform (WSL, macOS, Linux). If
  that guess is wrong — a non-default install location, or a WSL setup where the
  Windows username can't be read back through `cmd.exe` — set `PENCIL_MCP_BRIDGE`
  to the absolute path of the MCP server executable and it is used verbatim.
- `audit.py` — the checker. It reads the canvas through the bridge's `execute`
  tool, **read-only**: one `Get` visitor per frame with `resolveInstances: true`
  returns computed bounds and live props in a single call (`snapshot_layout` and
  `batch_get` no longer exist in the Pencil MCP API). It audits the app's
  **active canvas** (from `get_app_state`) and refuses to run unless that is
  `ab-initial-app.pen`; set `PEN_FILE` to the bridge's path form
  (`/Ubuntu/home/…/ab-initial-app.pen` under WSL) to override. Modes:
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

- The layout read reports **disabled nodes' ghost geometry**. audit.py filters
  these using live props: with instances resolved, every `instanceId/childId`
  carries its effective `enabled` (source value with the instance's overrides
  applied), so a fresh run has no ghost false-positives. If you see a finding on
  a node you believe is hidden, check the manifest's `[disabled]` marker before
  "fixing" it.
- **Component instances are measured inside and out.** Resolved instances come
  back as ordinary frames (the root keeps the instance id; internals are
  `instanceId/childId` paths) with real names and types, so name/type-based
  checks apply to them — a 31px "Button outline" instance on a mobile frame is a
  `TOUCH-TARGET` warning. The old `batch_get` crawl saw an instance only as
  `type: "ref"`, so these were never measured before; they are not new defects.
  Fix them at the component or per frame, or whitelist with a reason — don't
  read them as noise. The manifest recovers which component each instance uses
  (`-> component <id>(<name>)`), since resolved nodes drop their `ref`.
- `audit.py <id>` accepts any node id, not only top-level frames — `Get` scopes
  to that subtree.
- Phantom "+50px partially clipped" on fit-content bodies and
  "fill_container not inside flexbox" on disabled nodes: known tool noise.
- **A brand-new frame does not settle.** Freshly created nodes come back from
  `snapshot_layout` with a uniform **+50px y bias** (and `space_between` children
  pinned to the container's right edge), and `get_screenshot` / `export_nodes`
  render them blank — so audit.py reports _hundreds_ of phantom V-OVERFLOW and
  OVERLAP defects on a frame that is actually fine. Waiting, resizing, toggling
  layout/theme, Move, forcing a `batch_design` error, screenshotting and
  exporting all fail to clear it.
  **The fix: Copy the finished frame to a scratch position** — the copy lays out
  correctly and audits truthfully — **then delete the original and Update the
  copy's x/y/name.** Expect the surviving frame to carry a different node id
  than the one you built; update any notes that cite it.
  _(Observed under the old tools, `snapshot_layout`/`batch_design`. Under
  `execute`, building at a scratch position and doing `Copy` + `Delete(original)`
  in the same call has given frames that render and audit correctly first time —
  see `design/pen-lessons.md`.)_
- **Never delete children to restructure a container.** Removing children from an
  existing frame genuinely corrupts that frame's layout in this app (an in-place
  rebuild of one card left it rendering as an empty coloured box — not a
  measurement artefact, a real corruption). The "Insert-new + disable/Delete-old"
  advice above is for swapping a _leaf_; when a container needs restructuring,
  rebuild the whole frame and swap it in via the Copy trick.
- **The canvas is not saved by the MCP tools.** Everything an agent draws lives in
  the Pen app's memory until the app itself writes the file. `git status` showing
  `design/ab-initial-app.pen` unchanged after a drawing session does **not** mean
  nothing happened — it means nothing has been persisted yet. Confirm with
  `md5sum` against `git show HEAD:design/ab-initial-app.pen` and ask the user to
  save before treating any design work as done.

## Comparing a build with its frames (after implementation)

Design before build is only half the loop: once a UI feature is built, compare
the real screens with the frames they came from, desktop and mobile 360, before
the PR is called ready. This caught six real differences on the shifts build
(#86) that every test passed.

1. **Export the frames from the committed file**, never from old PNGs:
   `./scripts/export-frames.sh /tmp/frames <frameId> [frameId…]`
   (`SCALE=2` for a sharper image). It uses the pen.dev CLI headless —
   `npm install -g @pen.dev/cli`, then `pen login` once — so it needs no
   desktop app and reads what is in git, not an unsaved canvas. It opens a
   copy, so it cannot write to `ab-initial-app.pen`. Frame ids are in
   `design/pen-lessons.md`.
2. **Screenshot the build locally** with fake data (`pnpm e2e:local` — a
   throwaway spec that calls `page.screenshot` at each state works well), on
   both the desktop and the `mobile-360` project. Never the deployed apps.
3. **Compare section by section** under the rules in step 4 above: layout,
   copy, components, states present in the frame but missing in the build
   (and the reverse), and phone overflow.
4. **Disposition every difference:** fix it, or mark it deliberate when a later
   decision overrides the frame (say which decision). List them in the PR.

## Definition of done for any design change

1. `audit.py <touched frames>` → zero defects, warnings dispositioned
2. section screenshots of changed areas read correctly
3. desktop+mobile pair both updated
4. `audit.py --all` clean before telling anyone "the canvas is clean"
