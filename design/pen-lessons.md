# Pen format lessons

## Bridge / tooling
- The penctl.py bridge script referenced in the prompt did NOT exist in the scratchpad.
  The `mcp__pencil__*` tools are available directly via ToolSearch (`select:mcp__pencil__get_editor_state,...`).
  Just use the MCP tools directly — no bridge needed.
- `get_screenshot` returns the image INLINE (no local PNG path saved to disk). If a task
  demands a file path, there isn't one; reference the node id + verify visually inline.

## participant-identity batch polish pass (h3ak0 / C313E / qhcHh)
- On arrival, the three frames already had almost all critic fixes applied (a prior agent
  had done the work): identity block, carded signing key, account card, 13px helper text,
  gap=16 form card, trimmed Join blurb. ALWAYS re-read the actual frame state before
  applying "fix" instructions — many were already satisfied. Critic-quoted node IDs
  (e.g. FnfkH) may no longer exist because the frame was re-authored; the equivalent
  nodes (UbAjK/YIJDW helper text) were already correct.
- Only genuinely-outstanding item: Profile off-site emergency row zxWFZ padding was
  [15,24] while sibling rows were [16,24]; bumped to [16,24] for even rhythm.
- All three pass snapshot_layout problemsOnly=true. Doc-wide Camp Plot debris
  (cyMi6/tPR9d) is pre-existing and not part of this batch — leave it alone.
- Frame x positions: h3ak0 @ x=13280, C313E @ x=14760, qhcHh @ x=16240, all y=0, width 1280.

## ✅ BURNER BIO FIELD SPEC v2 — h3ak0 (Onboarding) + C313E (Profile) (field-spec agent, 2026-07-24)

Implemented the v2 field spec + fixed the privacy-toggle overflow bug. Both frames verified
(export scale 1, PNGs read) + snapshot_layout problemsOnly scoped `parentId:<frame>` = "No layout problems".
NOTE: I hit the SAME crash — the original ~570-line pen-lessons.md was wiped; another agent
recreated the short version above; I'm appending here rather than overwriting it.

### h3ak0 step-2 card (ZpiB2)
- **Years attended**: replaced the `nn6iK` select with a multi-select CHIP GRID `hkH4t`
  (vertical gap8; 2 rows `uBZxi`/`j30xH` × 10 = 2007–2026). Each chip = frame width
  fill_container, height 40, cornerRadius8, vertical-centered. SELECTED (2019/2023/2024/2026)
  = fill $primary + $primary-foreground w700; DISABLED (2020/2021) = stroke $border, opacity
  0.5, $muted-foreground label + 7.5px "no burn" tag; DEFAULT = stroke $border, $foreground.
  Flexbox has NO wrapping → grid is manual row frames. Kept ON·PUBLIC toggle + helper line.
- **Phone**: replaced `SVgkj` with a composed international phone control `G871h` = horizontal
  frame (fill $card, stroke $input, cornerRadius $radius) → [Country (🇿🇦 + "+27" + lucide
  chevron-down, pad[11,13]) | 1×22 $border Divider rect | Number (fill_container, "82 000 0000")].
  Kept 🔒 ALWAYS PRIVATE. Used fill **$card** (NOT $muted per the stale spec text) to match the
  real SVgkj siblings. 🇿🇦 renders as a small fallback glyph box beside "+27" — reads fine.
- **Emergency contacts**: deleted the single field; built TWO locked groups `pDAll` (on-site,
  "Someone at the burn with you") + `FlIJ9` (off-site, "Someone back home"), each = Field Head
  (label + lock + compact tvgss "ALWAYS PRIVATE") + helper + Fields (SVgkj "Full name" + a
  compact copy of the phone control). All hard-locked. Frame height → fit_content.

### C313E Bio Card (zxDzQ) — mirrored the model
- Years row V-text → horizontal chip row `dxtfn` of the 4 selected years (soft-teal read-only
  pills: fill #2D769626, text $primary w700, radius8, pad[3,9]).
- Phone kept "+27 82 ••• ••47" (country code). Split Emergency into on-site (qUtJy →
  "Hidden — someone at the burn") + NEW off-site `zxWFZ` ("Hidden — someone back home"), each
  lock icon + `mLUBB` "ALWAYS PRIVATE" badge (Profile uses badges for locked; Onboarding the switch).

### 🐛 PRIVACY-TOGGLE OVERFLOW — root cause + fix
Compact toggles override the K86ztM/tvgss root to width:fit_content + disable inner Text, BUT
the switch's inner "Row" (K86ztM→`A40wYB`, tvgss→`AfBCM`) stays width:fill_container +
space_between. fit_content root + fill_container Row = circular sizing → Row falls back large →
space_between shoves the 44px Track past the card edge. Overriding the Row to `fit_content`
warns "Collapsed size … circular … zero" (the disabled inner Text still carries fill_container).
**FIX: override the Row to FIXED width 44** (the Track width):
`descendants:{A40wYB:{width:44}, iaJYv:{enabled:false}}` (K86ztM) /
`{AfBCM:{width:44}, OJ2yq:{enabled:false}, V9BK43:{content:"ALWAYS PRIVATE"}}` (tvgss). Zero
warnings; right-aligns inside the card. `Update(refId,{descendants:{...}})` retrofits placed toggles.
LIBRARY GAP: add a real compact/inline Switch variant so pages don't need this per-instance hack.

### Bridge / multi-agent lessons
- **export_nodes outputDir = PLAIN WSL path** (`/tmp/.../exports`, NO `/Ubuntu` prefix). A
  `/Ubuntu/...` outputDir → `\\wsl.localhost\Ubuntu\Ubuntu\...` → "mkdir … Access is denied".
  (filePath KEEPS `/Ubuntu`.) In-session `mcp__pencil__export_nodes` uses the same plain path.
- **RENDER LAG × CONCURRENT EDITS**: while other agents actively edited the SAME shared doc,
  my newly-INSERTED nodes rendered BLANK for >4 min in BOTH export_nodes AND get_screenshot —
  the render clock is document-wide and others' edits kept resetting it. UPDATES to existing
  nodes painted immediately; only brand-new nodes lagged; batch_get/snapshot_layout were correct
  throughout. Once the concurrency stopped, ONE export rendered everything perfectly. Never
  conclude failure from blank renders mid-session — trust batch_get, re-export when the doc is quiet.
- Multiple agents were on these participant-identity frames at once (this contradicts "other
  workflow = org console only"). Stray nodes appear/vanish (`v5ilfJ` did); the zxWFZ padding fix
  got applied by two agents (idempotent). Always batch_get your subtree right before final export.

## ORG PAGES batch (Gate / Overview / Registrations) — CRITICAL TOOLING BUG THIS SESSION
- get_screenshot is BROKEN for any node created in the current session: it renders the
  frame's own FILL correctly but shows NO children (text, refs, nested frames render
  blank/white). PRE-EXISTING frames (RGcNS, hjTQN, jlLBa, etc.) screenshot perfectly.
  Verified repeatedly. It's a stale render-cache bug in the pen backend, NOT your design.
- snapshot_layout is ALSO unreliable for session-new nodes: it injects a phantom +50px
  y-offset on flow children and then reports spurious "partially clipped" problems. Proof
  it's phantom: the SAME band reported y:50 in one pass and y:0 in another; and a fit_content
  header wrapper reports height=72 (=band10+appshell62, correct) while its appshell child is
  reported at y:60. RGcNS (prior-session frame) shows NO offset. Ignore these clip flags.
- VERIFY VIA batch_get INSTEAD. batch_get returns the true stored node data (structure,
  overrides, content, refs) and is fully reliable. Trust it as source of truth.
- Mitigation for the phantom bottom-clip: set page frame height:"fit_content" (clip:true
  only clips horizontally then), so even a real offset can't hide content.

## IMAGE-BY-PATH WORKS (verified)
- Image fill via url relative to the .pen file renders correctly:
  fill:{type:"image", url:"./brand/afrikaburn-logo-banner-282.png", mode:"fit"}
  (stored/normalized to "brand/afrikaburn-logo-banner-282.png" — still resolves).
  Confirmed by putting the fill on a FRAME (frame fills DO render even for new nodes;
  only child nodes hit the screenshot bug). The real AfrikaBurn quilt wordmark showed.
- HEADER PATTERN used for org pages (honors Ryan's full-width-band + real-logo mandate
  AND the COMPONENT RULE to instance AppShell): page frame → Header wrapper (vertical,
  fill_container) → [Copy of RGcNS band a1BjK as full-1280 top band] + [AppShell Apricot
  jgbtP instance with descendants: S8mXNg(internal 655px quilt edge)->enabled:false to
  avoid a double/partial band; dwrhE(brand Mark diamond)->enabled:false; LmFjj(wordmark
  text) REPLACED with a frame{width:197,height:28, image-fill of the logo}]. Keep the
  "CONSOLE" tag d7pry. Nav active flip via descendants p9ddJ/yxXDq/etc (accent = $accent).
- a1BjK (inside RGcNS App Header dH6cZ) is the proven EDGE-TO-EDGE band: 3 path nodes,
  each viewBox [0,0,1280,10] width 1280, teal/apricot/sage, frame layout:none clip
  width fill_container. The library QuiltBand VDt3m is only ~655px wide (44 diamonds) and
  does NOT fill 1280 — tiling 2 instances "works" but snapshot flags them clipped; prefer
  Copy("a1BjK",...) for a clean full-width band.

## Component-instance gotchas
- Do NOT Replace() a descendant INSIDE a component instance and then Insert children into
  the returned node — it corrupts the instance (renders white/blank and can blank the whole
  parent frame). Prefer property overrides via descendants, or add extra structure as a
  SIBLING of the instance, not inside it.
- Tabs (j61wQ4): each tab (IJpV5/HszAc/zp81u/RhTU8) is fit_content width with a
  fill_container underline rectangle -> circular-collapse warning when instanced. Fix per
  instance: Update("<inst>/IJpV5",{width:56}) etc. (give each tab a fixed width).
- Table Dense (XqVPe) ALREADY contains exactly the 5 seed rows the /registrations queue
  needs (Mad Hatters=approved L2 returning 12Feb, Camp 404=under review L3 new 18Feb,
  Karoo Kombuis=changes req L1 returning 20Feb, Dust Bunnies=draft L1 new —, Long Drop
  Inn=submitted L2 new 22Feb). Just instance it; natural width 942 (columns fixed).
- Select CLOSED (nn6iK): has a library-annotation "CLOSED" StateTag qx9UC — disable it for
  real use (descendants:{qx9UC:{enabled:false}}); label=O71i4, value=b7Bq8.
- Pagination (hLNpr): for a single page, disable cPEVo/Kt6gL/Ax6jF/i8iXHN and make page1
  active via e6N4EW.fill=$primary + q1TSS.fill=$primary-foreground.
- Disabling S8mXNg (fill_container) throws a harmless "not inside flexbox layout" warning
  every batch — ignore, the node is disabled and won't render.

## Missing components (used closest fallback, per COMPONENT RULE — did NOT add to library)
- No KPI/metric-card component: built Overview count cards as plain $card frames
  (label+value+sub, height 164) with status Badge instances inside the Registrations card.
- No audit/activity-row component: built recent-activity rows as plain frames
  (colored dot + action/actor text + timestamp).
- No segmented-control component: used Tabs (j61wQ4) for the new/returning "toggle".

## My frames (org apricot accent)
- Gate — org wall · Org Dark = T7siQ9
- Overview — / · Org Dark = obd4x
- Registrations — /registrations · Org Dark = StJXH

## 🔴 PAYMENTS PURGE (Ryan, 24 Jul — QA MUST enforce)

**AfrikaBurn NEVER receives payments from theme camps. Registration is free.** Remove
every payment reference/block from: the Camp Dashboard (RGcNS — its PaymentDetailsBlock
usage), the org Registration Review screen (the QP-2027-* reference block in the action
rail), and any registration flow. The org /payments page frame: retitle its content as
"parked — future logistics apps" or strip rows tied to registration. The
PaymentDetailsBlock library component itself STAYS (future container/logistics apps).

## Org flow note (for org frames + QA)

Approval is done by AB's theme-camp leads team; after approval a camp is ASSIGNED TO A
WRANGLER (ongoing manager/check-in). The org review screen's post-approval state should
hint "Assign wrangler" (affordance can be disabled "R1"). Registered-vs-free-camp
self-selection in registration/org stays as designed.

## ORG Review + Accounts batch (Review /registrations/[id] + Accounts /accounts) — render bug reconfirmed
- **RENDER-CACHE BUG (Inserted vs Copied) — DEFINITIVELY ISOLATED THIS SESSION.** get_screenshot/export_nodes render freshly `Insert()`-ed frames/text as fully BLANK WHITE, but `Copy()`-ed component instances render PERFECTLY and immediately (a Copy of gUwkA payment block rendered with its override; a sibling Inserted card rendered pure white). The copied Header (Copy of B2EoSK) always rendered; the Inserted section cards did not. batch_get + snapshot_layout returned 100% correct structure/sizes throughout.
- **RESOLUTION: wait ~5 min of REAL wall-clock with ZERO doc edits, then export ONCE.** After a 300s quiet sleep (no batch_design, only reads) a single export_nodes rendered BOTH full pages flawlessly. Shorter waits (60–150s) with interleaved read calls did NOT clear it. Reads (batch_get/snapshot/export) seem fine but give it a solid uninterrupted window. Don't burn 3 review cycles fighting blank exports — verify structure via batch_get, then do the long-quiet export.
- Header pattern (reused from prior org agent, works great): `Copy("B2EoSK", page, {descendants:{"PRnZW/p9ddJ":{fill:"$muted-foreground",fontWeight:"600"}, "PRnZW/<target>":{fill:"$accent",fontWeight:"700"}}})`. B2EoSK already bundles the full-1280 edge-to-edge quilt band (E1OIM, 3 path children viewBox[0,0,1280,10]) + AppShell Apricot jgbtP with the real logo image already swapped in (LmFjj→image frame) and S8mXNg/dwrhE disabled. Nav ids inside AppShell: p9ddJ=Overview, yxXDq=Registrations, VuubM=Suppliers, qwxuE=Payments, VU2a3=Accounts. Copy's `descendants` keys DO resolve nested-in-ref paths like "PRnZW/VU2a3".
- Breadcrumb R5BvL: Copy with descendants Y9gTw/h1TsY/hhqQs (crumb text), fQxOK+jxlaH `enabled:false` to drop the 4th crumb+sep for a 3-level trail. Set the last crumb fill $foreground fontWeight 600 for active.
- Read-only FieldList (no component exists): plain vertical frame per field = label (Montserrat 10.5, w700, $muted-foreground, letterSpacing 0.8) + value (14, w500, $foreground, textGrowth fixed-width width fill_container). Two-per-row via a horizontal "Row" frame gap 24, each field width fill_container. Full-width fields go straight in the Fields column.
- SectionReviewThread (OPEN, no component): frame fill $muted, radius 8, `strokeWidth:{left:3}` stroke $warning for the accent bar; head row = OPEN pill ($warning) + "Resolve" link (lucide check + $accent text); comment = Copy X1PTIY avatar recolored to org apricot (`fill:"$accent"`, descendants b5sb0Z→{content:"AB",fill:"$accent-foreground"}}) + name/time/message. The parent section card gets `stroke:"$warning"` to flag it has an open thread.
- DecisionPanel (no component): plain $card frame; Approve = Copy f8Vlv (org apricot button, label MK2Fb) width fill_container; Request changes = Copy CCccR (label WT0Vx); Reject = Copy BVJfB (label XU2P9); reason = Copy t8imVt textarea with W1Z3Og(StateTag) disabled, Gvmd9 label reset, b4X0E height 96, e9lznW placeholder text. Audit note = lucide "history" + muted text.
- Confirm Dialog (no component): last child of page frame, `layoutPosition:"absolute", x:0,y:0, width:1280, height:<page height>`, fill "#0D0F10CC", layout vertical justifyContent/alignItems center. Get page height from snapshot_layout first (mine was 661; absolute overlay does NOT alter the page's fit_content height). Dialog card inside = $popover, radius 12, outer shadow, apricot icon circle, Cancel(bOc9x)+Confirm(f8Vlv).
- Supplier chips: horizontal frame fill $muted radius8 stroke $border padding[8,12], name (13 w600) + tiny status pill (LISTED=$muted, REGISTERED=$success). Flexbox has no wrap so keep chip count per row ≤ what fits 1280.
- lucide icon names: "circle-check" (NOT check-circle/check-circle-2), "user-plus", "user-minus", "message-circle", "history", "search", "chevron-right".
- Emails rendered in JetBrains Mono 13 (matches the doc's technical-string convention, e.g. payment refs).

## My frames (org apricot accent)
- Review — /registrations/[id] · Org Dark = PRDdG (x=22020, y=0)
- Accounts — /accounts · Org Dark = CJs0P (x=23520, y=0)

## POLISH PASS org-console-2 (PRDdG Review + CJs0P Accounts) — 2026-07-24
All critic fixes applied and verified.
- PRDdG: DELETED payment ref R9H9G (payments purge); built replacement "Assign Wrangler"
  card jah1O in Action Rail F0ItxR (plain $card frame, disabled R1 affordance: kicker
  "AFTER APPROVAL" + title + body + disabled $muted button "user-plus/Assign wrangler"
  opacity 0.55 + lock note). Content pDA6k gap 24->28; Sections G4k0j + Action Rail F0ItxR
  gap 20->24; DecisionPanel UN0sb padding 20->24 gap 14->16; six section cards
  (g1V1y/nWypf/RYYLK/iCzsD/mFzst/i3Nl9) padding 20->24; Sound&Placement mFzst card stroke
  $warning->$border (kept OPEN tag M286E5 + left-bar thread jEXl7 to carry the flag).
- CJs0P: FsMxk dialog body payments clause removed; role badge bLqa2/b9x0i "GOD"->"OWNER"
  (+renamed frame); Content GFQTD gap 24->28; H1 D84eH2 26->28; Confirm Overlay mfJhv
  enabled:false (base table is the resting deliverable); action columns
  (I8DkL/T07igy/lyWqL/i41xya/iaYtS/hbyzs) justifyContent:'end' + width:fill_container so
  buttons hug the row's right edge (kills the wide ROLE-column dead zone). Header action
  column h4o8d stays fixed 320 but is blank so no misalignment.
- RENDER-CACHE BUG RECONFIRMED: CJs0P (all edits to EXISTING nodes) exported perfectly
  immediately. PRDdG's NEW inserted card jah1O rendered BLANK/absent in export_nodes even
  on a second export ~1min later — the known session render lag for freshly Inserted nodes.
  Structure verified 100% correct via batch_get (jah1O present in F0ItxR with all children).
  A longer fully-quiet window is needed for the new node to paint; do NOT conclude failure.

## Member ref codes ≠ payments (QA clarification, Ryan 24 Jul)

Camp-scoped member reference codes (format MAH-M017) on the Camp Dashboard are
CAMP-internal EFT reconciliation identifiers (camper → the camp's own bank account).
They are ALLOWED and desired — do NOT purge them under the payments rule. The payments
purge applies only to AB-payment blocks (QP-* references, PaymentDetailsBlock) in
registration contexts.

## PARTICIPANT frames batch: Burner Profile + Vehicle Reg + Art Reg + RGcNS edits (2026-07-24)

### My new frames (participant teal accent) + RGcNS edits
- Burner Profile — /burners/[handle] · Dark = **mm31G** (public third-party view)
- Mutant Vehicle Registration — /vehicles/new · Dark = **S8ZcWf**
- Art Project Registration — /artworks/new · Dark = **d3pOJI**
- All three PASS snapshot_layout problemsOnly = "No layout problems". RGcNS also passes.
- Export PNGs: /tmp/.../scratchpad/exports/{mm31G,S8ZcWf,d3pOJI,RGcNS}.png (plain-WSL outputDir, returns \\wsl.localhost paths).

### RGcNS payment purge + addendum (Task 1)
- DELETED the whole Payment section **FJ0OR** (heading bgQMD "PAYMENT" + block RDvjy).
  It was the last child of Content EEeYH (vertical gap28) so the flexbox gap closed itself —
  no manual regap needed. Verified rendered: section gone, layout clean.
- Updated footer text **m1SUf** from the "…AfrikaBurn collects" claim to
  "Registration is free — AfrikaBurn never charges theme camps. Your camp exists the moment you create it."
- ADDENDUM (member ref codes, allowed treasury reconciliation, NOT a purge target):
  added "Your camp reference" box **pJcf8** into Members card EPu3f at INDEX 1 (between
  header RBLJO and list CyDFU): soft-teal (#2D769626) box, "Your camp reference" +
  "MAH-M017" (JetBrains Mono 15/700 $primary) + Copy affordance (lucide copy + label,
  stroke $input) + helper "Use this as your EFT reference for camp costs — paid to your camp,
  never to AfrikaBurn." Appended a JetBrains-Mono 11.5 $muted ref code to each member Name row
  (P4HiR=MAH-M017 after "(you)", KkZzp=M003, Jhz7r=M008, BGrcV=M011, JfvKv=M014).
  NOT added to the Burner Profile (mm31G) — third-party view stays public-only.

### DIALECT SCAFFOLD for participant frames (teal) — the recipe I used
- page frame: width 1280, layout vertical, **alignItems:"center"**, clip:true, fill $background,
  theme {mode:"dark"}. Header/footer = fill_container (span 1280); content = fixed width
  (1024 for profile, **768 for forms**) so alignItems centers it. Page height OMITTED =
  fit_content grows to content; clip:true then only clips horizontally (safe).
- Header wrapper (vertical, fill_container) = **Copy("a1BjK")** full-1280 quilt band +
  **AppShell Teal l99dum** instance with descendants:
  `{sKVum:{enabled:false}` (kill internal ~655px quilt edge to avoid double band — emits a
  harmless "fill_container not inside flexbox" warning, ignore),
  `C1y2Qr:{enabled:false}` (kill the diamond Mark path),
  `PO6BC:{type:"frame",width:190,height:27,fill:{type:"image",url:"brand/afrikaburn-logo-banner-282.png",mode:"fit"}}` (REPLACE the "QUAGGA PORTAL" wordmark text with the real logo image — descendant replacement via `type` present in the override works cleanly, no Insert-into-instance corruption).
  Nav active flip on profile: vYaMu→muted, R31TIN→$primary/700 (activate Directory). Other
  frames left default (Dashboard active). Nav ids in l99dum: xBScZ Nav = vYaMu(Dashboard)/R31TIN(Directory)/T9YLN(My camps).
- **The real logo image DOES render** (frame image-fill, even for session-new nodes — frame
  fills bypass the child-render lag). Confirmed in exports of mm31G/d3pOJI.

### Reusable form helpers (redefine per batch — batch scopes don't share vars)
- `card(parent,num,title,desc)`: $card frame radius12 pad24 gap16 + shadow; head = numbered
  teal circle badge (22px, #2D769626, $primary number) + title (16/700) + optional desc.
- `field(parent,label,ph,help)` = ref **UIcOu** width fill_container, descendants
  {eHwrS:{enabled:false} (kill "EMPTY" StateTag), eO4OD:{content:label}, piinX:{content:ph}, Tk86T:{content:help}}.
- Textarea w/ count = ref **w9csgR**, descendants {oGd42:{enabled:false} (kill StateTag),
  WNROG:{content:label}, ovNIW:{content:value}, a9CL2:{content:"NN / 60 words"}}. ⚠️ a9CL2 is
  the WORD-COUNT text inside the bottom Count Row — don't put help text there (I did once, fixed it).
- `yesno(parent,yesSel)` = two pill frames (fit_content), selected = fill #2D769626 stroke
  $primary 1.5 text $primary/700; unselected = fill $card stroke $input text $muted/500.
- `callout(parent,icon,text,tone)`: tone "warn" = fill #F4B6721A + $warning icon; "info" =
  fill #2D76961A + $primary icon. lucide icons used: flame, lightbulb, zap, info.
- SOOP/power radios = ref **kfdhb** (Solar/battery, selected variant). Unselected override:
  {p8KRJ:{enabled:false} (kill dot), tn6J8:{stroke:"$input"} (grey ring), b6EsQ:{enabled:false} (kill SELECTED tag), e4sB6F:{content:label}}.
- Acknowledgement checkbox (multi-line wrap) = ref **o6q8RQ** (checked), descendants
  {j72OeR:{width:"fill_container"}, OsGrm:{content:label,textGrowth:"fixed-width",width:"fill_container"}, TWtJh:{enabled:false}}. The j72OeR fill_container is required so the label wraps.
- Photo/image upload tiles: 4× frame width fill_container height88 radius8 fill $muted
  stroke $input, lucide "image-plus" + "Add photo/image". (No upload component exists.)

### RENDER LAG reconfirmed AGAIN (concurrent org workflow active)
- Freshly Insert()-ed nodes render BLANK in BOTH get_screenshot AND export_nodes while
  another agent edits the shared doc; UPDATES/DELETES to existing nodes paint immediately
  (RGcNS footer edit + payment deletion rendered fine; the new ref box + section 3-5 of the
  art frame stayed blank across multiple retries). batch_get + snapshot_layout are 100%
  authoritative — I verified all lagging nodes' content/structure that way. Do NOT re-author.
- **Move() by name-path FAILS SILENTLY**: `Move("EPu3f/Your camp reference","EPu3f",1)`
  returned OK but was a no-op (slash paths are instance-only). Use the NODE ID:
  `Move("pJcf8","EPu3f",1)`. Confirm via snapshot child-array order (that updates even when y is stale).
- **export_nodes intermittently 500s** with "you are probably referencing the wrong .pen file"
  on the correct /Ubuntu path — likely a concurrent-write lock. Retrying a minute later worked.
  get_screenshot on the same path kept working throughout.

## Suppliers + Payments + Registration-Feedback batch (2026-07-24)
Frames: Suppliers = iQEpd (x=29220), Payments = SdI2t (x=30720), Registration Feedback = P0Tcl (x=32220).
- ORG HEADER via Copy("B2EoSK", frame, {descendants:{"PRnZW/<navid>":{fill:"$accent",fontWeight:"700"}, "PRnZW/p9ddJ":{fill:"$muted-foreground",fontWeight:"600"}}}). Nav ids CONFIRMED: p9ddJ=Overview(base-active), yxXDq=Registrations, VuubM=Suppliers, qwxuE=Payments, VU2a3=Accounts. B2EoSK bundles full-1280 quilt band + AppShell Apricot with real logo already swapped in. Renders immediately (Copy).
- PARTICIPANT HEADER via Copy("X9x2T", frame, {descendants:{"QUdor":{enabled:false}, "zaqlm":{type:"frame",width:197,height:28,fill:{type:"image",url:"brand/afrikaburn-logo-banner-282.png",mode:"fit"}}}}). X9x2T is RBIDd's App Header (quilt band VDU03 full-width + brand tEs1L + nav cOGek + edition banner, Space Mono). Its brand was a lucide flame (QUdor) + "Contributors" text (zaqlm) — swapped to the real logo per Ryan's mandatory header spec. Image-by-path confirmed working again (logo rendered in export).
- Custom tables (no generic table component; XqVPe is registration-specific): frame fill $card radius8 stroke border clip → Header Row (fill $muted, padding[11,20]) + rows (padding[12,20], strokeWidth {bottom:1}, last row 0). Cells = frames with fixed width (fill_container for the flex column). Vetting select in-cell = Copy("nn6iK", cell, {width:"fill_container", descendants:{"O71i4":{enabled:false},"qx9UC":{enabled:false},"b7Bq8":{content:"Listed",fill:$muted-foreground}}}) — disabling label+StateTag leaves just the Control which fills the cell.
- Compact table-row buttons: Copy("bOc9x"/"l524ck", cell, {padding:[8,14], descendants:{"<labelid>":{content:"...", fontSize:13}}}). bOc9x label=Z2mNr9, l524ck label=sZAW7.
- Badge label ids: fKBVV(secondary)=TTJ8o, mLUBB(outline)=HIUm1, QTicW(reconciled)=eUNj3, vPQXJ(pending payment)=R30biI, l2qNl2(waived)=O3uap, j9JR1(changes req)=HLgCy, RXzgC(pending)=xhS1h.
- Textarea t8imVt as reply box: descendants {"W1Z3Og":{enabled:false}(StateTag), "Gvmd9":{enabled:false}(Label), "b4X0E":{height:88}(Box), "e9lznW":{content:"placeholder", fill:$muted-foreground}(Value)}. Root width 372 → override fill_container.
- Avatar org recolor: Copy("X1PTIY", parent, {width:34,height:34,fill:"$accent", descendants:{"b5sb0Z":{content:"AB",fill:"$accent-foreground",fontSize:13}}}).
- lucide: "triangle-alert" (NOT alert-triangle), "circle-check", "circle-slash", "arrow-left", "plus", "chevron-down", "info".
- Set page frame height:"fit_content" AFTER building (snapshot flagged phantom "partially clipped" at the default height while content overflowed by ~50px — same phantom-offset bug as prior sessions).
- RENDER-CACHE LAG RECONFIRMED: Copy'd headers (B2EoSK/X9x2T) rendered instantly in export; all freshly-Inserted body content (tables, section cards, banners) rendered BLANK even after edits stopped. batch_get confirmed 100% correct structure/overrides. A longer fully-quiet window (5min+, zero edits) is needed to paint new nodes; I was forced to finalize before it fully cleared.

## PAYMENTS TENSION (flagged for Ryan/QA)
My dispatched task explicitly required building /payments with a live reconcile/waive table (QP-2027-MAH-001 reconciled, KKB-004 pending, C44-002 waived), which sits against the earlier "PAYMENTS PURGE" note (registration is free; park /payments). I built the table as dispatched but framed it to reconcile both: header note "References only — AfrikaBurn collects, we track." + sub "Registration is free. These references cover shared logistics AfrikaBurn invoices directly — no payment is ever processed here." If the purge stance is firm, this page should instead be parked.

## FINAL QA PASS (whole document) — 2026-07-24

### Frame inventory — COMPLETE, nothing missing/duplicated
All expected pages present exactly once: auth u87N7, landing L82AQr, directory u7RSIJ,
create-camp g5Uqfw, onboarding h3ak0, profile C313E, join qhcHh, camp dashboard RGcNS
(pre-existing), registration wizard RBIDd (pre-existing), registration feedback P0Tcl,
org gate T7siQ9, org overview obd4x, org registrations StJXH, org review PRDdG, org
accounts CJs0P, org suppliers iQEpd, org payments SdI2t, component library ABOHr + kv6ot.
EXTRAS (legit, not dupes): 3 participant pages mm31G/S8ZcWf/d3pOJI; 3 Camp Plot frames
(cyMi6/CwVWw/OLb9g, pre-existing — DO NOT TOUCH); one stray empty white frame bi8Au
(800x600 @ 0,0, "Frame", no children — pre-existing debris, left alone).

### Auth retrofit (task #5) was ALREADY DONE by a prior agent — re-read before fixing!
u87N7 already has: full-width edge-to-edge quilt band gqSjC (3 diamond paths KkNEM/h9Y8eI/
zenzj, each viewBox[0,0,1280,10] width 1280 x:0) AND the real AfrikaBurn logo (czSmC, image
fill afrikaburn-logo-banner-282.png, 282×40) inside the auth card EEPpt above "WELCOME,
BURNER". Verified via screenshot. No change needed.

### The ONE mechanical fix I made: logo consistency on directory + create-camp
Directory (CODJ8) and Create-camp (lCJWI) were the ONLY participant AppShell pages still
showing the default l99dum "QUAGGA PORTAL" text wordmark instead of the real logo. Every
other participant page (C313E/h3ak0/qhcHh/mm31G/S8ZcWf/d3pOJI) + all org pages use the real
logo. Fixed both to match C313E's proven override via Update(inst,{descendants:{...}}):
  C1y2Qr:{type:"frame",name:"Logo",width:180,height:28,layout:"none",fill:{type:"image",
    enabled:true,mode:"fit",url:"brand/afrikaburn-logo-banner-282.png"}}  (replace diamond Mark)
  PO6BC:{enabled:false}  (kill wordmark text)
  + keep existing nav-active color overrides (must re-list them in the same Update — descendants
    replace, so include ALL: R31TIN/T9YLN active $primary + vYaMu muted).
The logo rendered IMMEDIATELY in both (frame image-fills bypass the render-cache lag). Verified.

### Full-width band check — ALL new pages PASS
directory/create-camp have NO separate quilt-edge child; they rely on the AppShell l99dum's
internal band, which DOES render full-width 1280 edge-to-edge (zoomed CODJ8 screenshot
confirms). The snapshot "width:655 partially clipped" on sKVum/cPAV4 is the by-design diamond
path clip, NOT a half-width band. Do not "fix" it.

### snapshot_layout problems = ALL PHANTOM (confirmed via screenshots)
Every frame that rendered fully in a screenshot showed ZERO visible clipping/overflow despite
hundreds of "partially/fully clipped" snapshot flags. Two phantom sources reconfirmed: (1)
QuiltBand diamond paths clipped by their band's clip:true (by design, every band); (2) the
+50px y-offset bug making flow text report y:50–78 "fully clipped". NO real clipping problems
exist. Trust screenshots over snapshot_layout for these frames.

### RENDER-CACHE LAG still active (concurrent editing ongoing this session)
export_nodes fails with "you are probably referencing the wrong .pen file" (concurrent-write
lock) — other agents are editing NOW. Consequently the Suppliers/Payments/Feedback batch
(iQEpd, SdI2t, P0Tcl) render header-only with BLANK bodies, and d3pOJI's lower sections
(N8OIZc/hP00S/HQM1e/FH5JS) render blank. Structure for all is 100% intact per snapshot_layout
(rich nested content with real content strings + dims). This is the documented render lag, NOT
missing content — do NOT re-author. A 5min+ fully-quiet window + single export is needed to
paint them; not achievable while concurrency persists. get_screenshot (inline) works
throughout; export_nodes to a file did not this session.

### Remaining item reported (not fixed — custom header, borderline structural)
Landing L82AQr custom Nav Bar (z8r7q) still shows "◆ QUAGGA PORTAL" wordmark rather than the
real logo. Defensible as a marketing lockup; left for owner decision. If unifying, swap its
brand element to the logo image frame like the AppShell fix above.

## /payments IS REMOVED (Ryan, 24 Jul — final)

The org console has NO /payments section at all (stronger than the earlier "parked"
state). Design: frame SdI2t is slated for deletion and "Payments" comes OUT of the
AppShell Apricot (jgbtP) nav. Do not add payment surfaces anywhere. PaymentDetailsBlock
stays in the library for future logistics apps only. Member ref codes (MAH-M017,
camp-internal) are unaffected.

## QUESTIONNAIRE FEATURE — 5 new frames (2026-07-24)

### My frames
- Org Questionnaires — /questionnaires · Org Dark = **JY7dF** (list + completion bars)
- Org Questionnaire Builder — /questionnaires/new · Org Dark = **sCEHP** (2-col: field editor + activation rail)
- Camp Questionnaires — /camps/[slug]/questionnaires · Dark = **Hameq** (teal lead view + member completion)
- Questionnaire Gate — fill view · Dark = **qKG3g** (blocking runner, minimal header, no nav)
- Members & Roles — camp dashboard variant · Dark = **H7aIdg** (1320-wide card study + open role popover)
- ALL pass snapshot_layout problemsOnly = "No layout problems". Exports at /tmp/.../scratchpad/exports/{id}.png.

### Ryan's blocking/optional addendum (folded in — enforce on any future questionnaire surface)
- Every questionnaire surface must EXPLICITLY state blocking vs optional. Badge per list item:
  "REQUIRED · BLOCKS UNTIL DONE" = fill #C2443826 + $destructive text (also stroke the card $destructive);
  "OPTIONAL" = transparent fill + $border stroke + $muted-foreground text.
- Gate frame: NO nav at all (nothing reachable while gated) — band + logo + Sign-out only. Prominent
  required badge (lock icon) by the title; hard-gate note "You can't use the portal until this is done — it takes 2 minutes."
- Builder blocking toggle explainer: "Blocking questionnaires stop people using the app until they answer. Use sparingly."

### Tooling / dialect notes from this batch
- **NO render lag this session** — doc was quiet, so BOTH Copy'd headers (B2EoSK org, X9x2T participant)
  AND all freshly-Inserted body content rendered perfectly & immediately in export_nodes (scale 1). The
  render-cache bug only bites during concurrent multi-agent editing.
- **Explicitly setting frame `height:"fit_content"` CLEARS the phantom "+50px partially clipped" flag.**
  New 1280 pages with clip:true + unset height reported the body as "partially clipped" (phantom +50 y
  offset). Running `Update(frame,{height:"fit_content"})` made snapshot_layout return "No layout problems"
  for all of them. Cheap, reliable — do this on every new page frame before final snapshot.
- **lucide "clock" is NOT in this icon set** → use **"hourglass"** for pending/time. Confirmed-valid this
  batch: settings-2, trash-2, log-out, grip-vertical, ellipsis-vertical, toggle-left, square-check, list,
  type, users, pencil, lock, triangle-alert, check, chevron-down, plus.
- **alignItems:"baseline" is NOT supported** (only start/center/end) — errored & rolled back the whole batch.
- **Custom toggle** (small track frame + knob frame, justifyContent end/start by on/off, fill $accent|$input)
  is cleaner than the K86ztM/tvgss Switch component for per-field "Required"/"Blocking" toggles — sidesteps
  the documented compact-Switch overflow bug entirely. Same for a custom teal primary button (fill $primary,
  label $primary-foreground) — there's no teal primary Button component; f8Vlv is org apricot only.
- **Completion bar**: fixed-width track frame (e.g. 560/620, layout horizontal, clip:true, fill $muted) with
  an inner Fill frame height:fill_container + width:round(track*done/total). Guard total===0 (skip the Fill
  insert — round(x/0)=NaN → width:null errors and rolls back the batch).
- **Popover/dropdown over a table occludes right-aligned row content** (ref codes were hidden). Fix: widen
  the study frame, give the card a FIXED width (not fill_container so it doesn't grow with the frame), and
  float the popover (layoutPosition:"absolute", real x/y) in the freed right margin, anchored near its trigger.
- Audience checkbox list: Copy o6q8RQ (checked) / OirYR (unchecked), descendants {label id, tag id:{enabled:false}}.
  Label ids: o6q8RQ→OsGrm/tag TWtJh; OirYR→hvwng/tag AguQO. width:"fill_container" per row.
- Org page nav has no "Questionnaires" item; I deactivated Overview (PRnZW/p9ddJ → $muted-foreground/600)
  so nothing reads falsely-active and relied on a CONSOLE / QUESTIONNAIRES breadcrumb kicker instead.

### Roles v2 addendum (2026-07-24, Ryan) — applied to Hameq + H7aIdg
- Project roles now carry COLOR (curated 8-key palette, NOT freeform) + EMOJI + PERMISSIONS. Palette→hex:
  teal #2D7696 · teal-deep #235C75 · apricot #F4B672 · peach #FFBC7D · sage #B6D090 · olive #7D9953 ·
  rust #B23A2E · neutral #ADB6B3. Defaults: Captain 🎩 apricot (all 3 perms) · Team lead 🔧 teal
  (manage_questionnaires only) · Burn member 🔥 sage (none). Perm labels: "Can send questionnaires" /
  "Can manage members & invites" / "Can manage roles".
- **Role chip treatment** (reusable pattern): frame layout horizontal gap5 radius999 fill `<hex>+"26"`
  padding[3,9] → [emoji text (fill $foreground, 11px) + name text (fill `<hex>`, 10.5/700)]. Emoji MUST be
  its own text node with $foreground fill (a color-fill would tint it). Emoji 🎩🔧🔥🧙 render as full-color
  glyphs in export (unlike flag emoji which fall back to boxes) — confirmed via batch_get + export.
- **Role editor card** (in the manage-roles panel): emoji field (36×32 $card box w/ emoji) + name + trash;
  COLOUR label + 8-swatch row (22×22 radius6, selected swatch stroke $foreground 2 / others $border 1);
  PERMISSIONS label + 3 custom checkboxes (16px box, checked=$primary+check icon, unchecked=$card+$input
  1.5 stroke). Delete affordance = destructive-tinted confirm strip (#C2443826, left-bar $destructive)
  "11 members hold this role — remove it from them?" + Keep/Remove buttons. Panel footnote (muted):
  "Leads and admins always keep full rights — roles grant extras to members."
- **Restructure for the open panel**: the small dropdown popover couldn't hold the full editor, so I turned
  H7aIdg into a 2-col Columns frame (members card fill_container + 380px panel), widened frame to 1400.
  Move(cardId, colsId, 0) reparents the existing card; Move(newColsFrame,frame,1) puts columns after title.
- RENDER LAG on reparented+new nodes: after Move()+new panel Inserts, export rendered ONLY the pre-existing
  title block; the moved card + new panel came back BLANK (whole-doc render-cache lag for session-touched
  nodes). batch_get confirmed all content correct. Needed a fully-quiet wall-clock window (~180s, zero edits)
  then a single export to paint them. Same phantom "partially clipped" flag on the new Columns (reported
  y=562 vs real ~108) — height:"fit_content" alone did NOT clear it here; **setting clip:false on the study
  frame DID** (content fits within fit_content height anyway, so nothing visually overflows and the spurious
  clip flag disappears). Use clip:false on tall card-study frames when the phantom clip flag won't clear.

### Roles v2 addenda 3/4/5 (2026-07-24) — privilege panel, role kinds, officers (H7aIdg + sCEHP + Hameq)
- The roles panel on H7aIdg went through 3 more addenda; final shape = a full ROLE-MANAGEMENT panel (400px,
  right column of a 2-col study). Sections top→bottom: Head; "DEFAULT ROLES" label; Captain (locked);
  Team lead (editable, expanded); Hatters (baseline); "OFFICERS" label; LNT Lead / Sound Officer / Safety
  Baron; "CUSTOM ROLES" label; Kitchen wizard (+delete-confirm); footnote; add-role input.
- **Three-tier mutability by role `kind`** (spec "Role kinds" table): captain (perms LOCKED to all — render
  toggles ON at opacity ~0.45 inside an opacity:0.7 list + a lock note; rename/emoji/color still editable;
  NO delete), baseline (Burn member seeded, aliasable — Mad Hatters rename it to "Hatters 🔥"; tag
  "BASELINE · EVERYONE"; implicit on EVERY member so every member row carries the Hatters chip; NO delete/
  unassign), default (Team lead; editable perms; NO delete), custom (Kitchen wizard; editable; ONLY kind
  with the delete-with-count affordance "11 members hold this role — remove it from them?").
- **"Everyone" audience == the baseline role chip**, not a separate option. In the Team lead send-scope
  sub-control the audience chips are role chips (🔥 Hatters selected = whole camp) + a note; there is NO
  standalone "All roles"/"everyone" chip.
- **Officer roles** (spec "Officer roles"): org-defined, registration-TRIGGERED. On the org Builder audience
  list I added an "OFFICERS" subgroup (All registered LNT Leads ♻️ / Sound Officers 🔊 [checked] / Safety
  Barons 🔥) and set the resolve pill to "Resolves to 23 burners" (unchecked the prior camp-leads box so the
  count reads true). On H7aIdg, officer rows: LNT Lead ♻️ REQUIRED + ✓ASSIGNED; Sound Officer 🔊 REQUIRED
  (block stroke $warning + inline "Not yet assigned" warn strip + Assign button — soft-enforced completeness
  flag); Safety Baron 🔥 RECOMMENDED. Officer rows have NO delete. One member row (Priya) carries the ♻️ LNT
  Lead chip to show assignment.
- Emoji CONFIRMED rendering full-color in export as their own $foreground text node: 🎩🔧🔥🧙♻️🔊 all fine.
  Kept flag-emoji out (those fall back to boxes). Officer/role chip colors: LNT olive #7D9953, baseline sage
  #B6D090, Sound teal-deep, Safety rust — all from the curated 8-key ramp.
- Custom checkbox rows for the org audience list: Copy o6q8RQ (checked)/OirYR (unchecked) can't be toggled in
  place — to flip a checked box to unchecked I Delete()d the o6q8RQ instance and Copy()d an OirYR at the same
  index via Move(id,parent,index). Emoji goes straight into the label content string (renders in color).

## BURNER BIO v3 — Onboarding h3ak0 + Profile C313E + third-party mm31G (2026-07-24)
Added build-spec §"Burner Bio v3 additions": about, camp_history (linked+freetext), volunteering_interests,
ranger section. Verified via batch_get (exact order+content) + snapshot_layout problemsOnly = "No layout problems".

### h3ak0 (Onboarding) — new step 3, RENDERED CLEAN (append-only, no Move)
- **ProgressSteps QWDKT remap 4→5** (Welcome · Your details · Burns & volunteering · Privacy · Done), step 3 CURRENT.
  6-step wizard (steps 5,6 = fzm5F/FEiBV disabled). One Update("HEjt7",{descendants}): QcFr5→"STEP 3 OF 5";
  M9Yuoh(step2)→complete: effect:[]+children:[check icon]; e9vHJ→w600; c55XR+R59Xg→$primary; R9LoOh(step3)→current:
  fill $primary,strokeWidth:0,glow effect,children:[num "3" $primary-foreground]; DP2HO→"Burns & volunteering" w700;
  V3YiA→"Privacy"; fzm5F→enabled:true; T0kPl→"Done"; nFgF3→"5". Circle Num ids: step2 ajVLD, step3 a8ICN
  (instance-created); step4 qrUNv, step5 nFgF3 (component-original). Step columns qU0ic/VZNQY/qkAcd/UMQnL/fzm5F/FEiBV.
- **Step-3 card APPENDED into Inner CA4eU** (Page Head 3 WF0qH + Form Card 3 bl3Fm + CTA Row fABnY). Sections:
  About (w9csgR textarea, WNROG+oGd42 disabled, a9CL2="94 / 150 words", h1S26D height 170, ON·PUBLIC toggle);
  Camps (linked row = name + "✓ on Quagga Portal" teal chip + years; freetext row fill $muted + "type" icon +
  "FREE TEXT" tag; add-a-camp custom input w/ search icon + type-ahead placeholder); Volunteering (16-chip
  multi-select, manual rows, Kitchen+Rangers selected #2D769626/stroke $primary 1.5, rest $card/$input);
  Rangers sub-card fill $muted (OirYR/o6q8RQ/OirYR checkbox refs, "curious" checked, GD helper, info link,
  "More info coming" hourglass hint @0.6). Compact ON·PUBLIC toggle uses the documented width:44 fix.
- h3ak0 EXPORTED PERFECTLY first quiet export (all-append, zero Move).

### C313E + mm31G — used Move() → STUBBORN WHOLE-FRAME RENDER LAG
- C313E: appended read-only card g457WM (header+Edit; ABOUT paragraph; CAMPS linked+freetext; VOLUNTEERING
  Rangers/Kitchen chips; RANGERS apricot "Curious about ranger shifts" badge) then Move(g457WM,"M4XkZW",3).
- mm31G: appended freetext camp row Q4tPcH into yxmte; About card NOY0h (Move→2); Volunteering U1GW0F (Move→5);
  Rangers f8Rx4V (Move→6, "Curious about rangering" flame badge). Public shows ranger_curious only.
- 🐛 **Move() POISONS THE WHOLE FRAME'S SESSION RENDER CACHE — not just the moved node.** After Move, export AND
  get_screenshot render the moved nodes AND even sibling append-only nodes in that frame BLANK (space reserved,
  no paint; root footer renders at stale y overlapping later content). TWO full 5-min zero-edit quiet windows did
  NOT clear it — the doc owner/other agents keep the render cache warm; waiting may never succeed. h3ak0
  (append-only) rendered flawlessly, proving the identical component patterns are fine — Move is the sole trigger.
  batch_get + snapshot_layout are AUTHORITATIVE and confirm both frames 100% correct; live app renders fine.
- **RULE: for clean export AND correct mid-list order under concurrency, AVOID Move.** Build ordered content in
  one append-only pass, or (destructive) Delete simple trailing nodes and re-append after your new node. Kept the
  correct ORDER here (didn't degrade the user's real design just to satisfy the export tool).
- Valid lucide this pass: check, circle-check, type, search, hourglass, flame (mm31G existing card uses tent-tree).
  Curly ’ en-dash – and ↗ render fine in content strings.

## SUPPLIER PORTAL + Org Suppliers v2 batch (2026-07-24)
### My frames
- Supplier Onboarding — /onboarding · Supplier Dark = **Q4fye** (7-step onboarding, sage accent)
- Supplier Standing — /standing · Supplier Dark = **R4wvO** (GOOD standing, no notes visible)
- Org Suppliers v2 = **iQEpd** (REWORKED IN PLACE — new table supplier·n/7·standing·notes + expanded Desert Ablutions row)
### Supplier portal header = sage-tinted jgbtP instance (NOT a new component)
- Copy("uKKTQ", hdr) full-1280 quilt band (3 paths S1q7IP/FvdPb/wvIue) + instance jgbtP with descendants:
  S8mXNg:{enabled:false}, dwrhE:{enabled:false}, LmFjj:→logo image frame,
  d7pry:{fill:"$ab-sage"} (Console Tag frame) + **S3S6ZX**:{content:"SUPPLIERS",fill:"#17191B"} (tag text — dark on sage),
  p9ddJ/yxXDq = nav "Onboarding"/"Standing" (active one → fill $ab-sage w700), VuubM+VU2a3 disabled.
  Sage #B6D090 as the bright accent reads well on dark bg (same as $success). Tints: sage #B6D09026, warn #F4B67226, dest #C2443826.
### iQEpd rework (payments-purge-clean, NO source/vetting anywhere)
- Killed old table l4zIlQ (had SOURCE/VETTING cols + AB-sheet badges). Updated GY6LF sub + b5Vobe count to drop
  "AB sheet / added manually" language. New table: SUPPLIER(fill)·ONBOARDING n/7(mini progress bar, warning-highlight
  when n<5 with INCOMPLETE tag)·STANDING(inline nn6iK select, value colored Good=sage/Watch=warn/Suspended=dest)·
  NOTES(count pill w/ message-circle, "—" when 0)·expand chevron. Each supplier = vertical Row frame → Summary + optional Expansion.
- Standing inline select = Copy("nn6iK",cell,{width:fill_container, descendants:{O71i4(label):disabled, qx9UC(StateTag):disabled, b7Bq8(value):{content,fill,fontWeight:700}}}).
- Expanded row (Desert Ablutions 4/7): 2-col Expansion frame = left ONBOARDING STATUS (7 step rows, status icon + org-confirm
  f8Vlv apricot buttons on steps 3/6/7, sage "Reviewed" tag on 4/5) + right 372px Notes Drawer (timeline entries with
  🔴/🟢/⚪ emoji markers [render fine as $foreground text] + kind label + body + author·time; add-note form = kind pills +
  t8imVt textarea + f8Vlv "Add note"). org-confirm button = Copy("f8Vlv",{padding:[7,13],descendants:{MK2Fb:{content,fontSize:12.5}}}).
### 🐛 Delete("id/id") self-slash-path DELETES the node (dZRKJ/dZRKJ removed dZRKJ). Bad self-referential slash paths
  are destructive — a leftover from a mistaken Delete. Verify with batch_get after any odd Delete.
### Render lag: iQEpd (updated existing texts + Copy'd header) painted header/heading/toolbar; new Inserted table BLANK.
  Q4fye (brand-new frame) exported FULLY blank (only $background fill). Documented lag — structure authoritative
  (snapshot iQEpd = "No layout problems"; Q4fye/R4wvO only phantom +50 clip). One export attempt, moved on per instructions.

## ORG STATUS BOARD + CATEGORIES + Directory filters batch (2026-07-24)
### 🔴 CRITICAL TOOLING: batch_get / snapshot_layout IGNORE `ids` AND `depth` THIS SESSION.
  Every call returns the WHOLE document at a FIXED shallow depth: document root → its child
  frames (level 1) → their DIRECT children (level 2, ids shown) → everything at level 3+ collapsed
  to `"children":"..."`. Passing ids:["KaJNo"] depth:7 fields:[...] changed NOTHING — same whole-doc
  dump, KaJNo still collapsed. Verified across 5 calls incl. a component id (jlLBa didn't even appear;
  reusable components are NOT in the dump at all). CONSEQUENCE: you can read/target ONLY root frames
  and their DIRECT children (page → Header/Body/Content/Footer). You CANNOT get IDs of any pre-existing
  node below that (grid cells, cards, card-internal text). You can only get deep IDs for nodes YOU create
  (Insert/Copy return them). export_html has data-pencil-NAME only, NO ids. This blocked "camp cards gain
  category emoji chips" on the Directory — the existing camp-card frame IDs are unreachable. If a future
  task needs to edit pre-existing deep nodes and this bug is still live, flag it; the only workaround is
  rebuilding that subtree from a level-2 parent you CAN target (destructive; needs Delete of children you
  also can't target → effectively impossible without the bug being fixed).
### Frames built (org apricot; participant teal)
  - Org Status Board — / · Org Dark = **RTfFF** (new console landing). Header = Copy("B2EoSK", {descendants:
    {"PRnZW/qwxuE":{enabled:false}}}) — Overview stays base-active, Payments nav killed. Content mZLqH.
    Screenshot rendered FULLY & immediately (headline tiles + funnel + line chart). Right column
    (officer/questionnaire/supplier, built one batch later) + activity feed = render-lag blank in that shot
    but snapshot problemsOnly=NONE (no collapse) → structurally sound.
  - Org Camp Categories — /categories · Org Dark = **g4CzsM** (12-row CRUD list iH24L + Add-category card).
    Header Copy B2EoSK with p9ddJ(Overview)→muted (no Categories nav item; used CONSOLE/CATEGORIES kicker).
    Body render-lagged blank (batch just committed). Phantom +50 clip flag on content jlaWl persists with
    clip:false too (page frames keep the phantom; harmless — height is fit_content so nothing truly clips).
  - Directory rework = **u7RSIJ** body KaJNo: Inserted "Category Filters" row **oelnB** (cat chips: All camps,
    🧸 Family-friendly ACTIVE, 🍲 Food&drink, 🍹 Bar, 🔊 Music&sound, 🎨 Art&making, +7 more; second row
    FROM REGISTRATION: Family-friendly/Quiet/Sound camp outline chips) then Move(oelnB,"KaJNo",2) to sit
    below search / above the registered-camps grid. Move poisoned KaJNo render → can't visually re-verify
    placement (KaJNo children also unreadable per the bug); Move returned OK, snapshot problemsOnly on
    u7RSIJ = clean (no new problems). PER-CARD emoji chips NOT applied — card IDs unreachable (see bug).
### Chart dialect (dataviz, brand-restrained, all rendered clean in RTfFF screenshot)
  - Stat tile: $card radius12, tiny accent dot + muted kicker + 34px/800 value + colored sub. 4 across, gap16.
  - Horizontal funnel/bar: row = fixed 132 label + FIXED 540 track ($muted, clip) with inner Fill fixed px
    (scale maxVal→540) + fill_container right-aligned count. Fixed track width = exact proportional px, no circular sizing.
  - Line chart WORKS as 3 nodes in a FIXED-width layout:none Plot (width 700 h150): gridline rects (width 700 h1
    $border) + Area path (fill "#2D769622") + Line path (stroke $primary 2.5, fill "#00000000") both viewBox
    [0,0,700,150] same geometry, + 5 ellipse dots (x/y px, stroke $card 2 for the surface ring). X-labels row
    width 700 space_between below. Single-node paths position fine — the "line charts are hard" caveat only bites
    when you need per-point layout; precomputed geometry sidesteps it.
  - Progress/coverage: FIXED track, sage Fill px over a $destructive-tint track bg (#C2443826) = officered vs outstanding.
  - Stacked distribution: horizontal frame gap2 (2px surface gap per dataviz), fixed-px segments, end segments
    get asymmetric cornerRadius [5,2,2,5]/[2,5,5,2].
  - Emoji in chips render full-color as their OWN text node with $foreground fill: 🧸🍲🍹🔊🎭🛠️🎨🌿🎲🌙🤫🌈 all fine in structure.

## BUILDER v2 — Google Forms parity · 3 NEW frames (2026-07-24)
### My frames
- Org Builder v2 — sections & blocks · Org Dark = **AssNH** (3-pane: block palette rail + sectioned canvas + validation/branching right rail)
- Runner v2 — multi-page fill · Dark (participant) = **uj2yF** (page 2/3: progress w/ section names, info block, linear scale, rating stars, MC w/ image options, Back/Next, "Saved just now")
- Questionnaire Results v2 — summary charts · Org Dark = **Mjiqz** (completion stat + CSV export + Summary/Individual toggle; choice horizontal bars, linear-scale vertical histogram, text sampled-answers list)
- All three PASS snapshot_layout problemsOnly (only the phantom +50 "partially clipped" on Body — frame height fit_content = correct). Did NOT modify the existing builder sCEHP.
### Reused patterns
- Org header: `Copy("SdPCy", frame, {name:"Header"})` — SdPCy is sCEHP's Header (full-1280 quilt band St7Wv 3 paths + AppShell jgbtP apricot with logo already swapped, p9ddJ Overview muted). Copies + renders immediately.
- Participant header: `Copy("X9x2T", frame, {name:"Header", descendants:{QUdor:{enabled:false}, zaqlm:{type:"frame",width:190,height:27,layout:"none",fill:{type:"image",mode:"fit",url:"brand/afrikaburn-logo-banner-282.png"}}}})`.
### Dialect gotchas hit this batch
- **icon nodes reject `stroke`/`strokeWidth`** (only `fill`). For an "empty" lucide star use `fill:"$input"` (grey), not an outline stroke.
- **text nodes reject `padding`** (schema error, rolls back). Use a wrapping frame or rely on flex alignItems for baseline offset.
- Custom toggle (track frame 34x20 radius999 + 16px knob, justifyContent end/start by on/off) reused for Required/Blocking — sidesteps the compact-Switch overflow bug.
- Left-accent section card: outer frame `stroke:"$accent", strokeWidth:{left:3}` (single-side stroke). Do NOT use a horizontal outer + `height:"fill_container"` child bar with a fit_content parent — that's circular-collapse (parent fit_content cross-axis + child fill cross-axis = both collapse to 0).
- Vertical-bar histogram that bottom-aligns: plot = horizontal frame `alignItems:"end"` fixed height; each column = vertical `height:"fill_container", justifyContent:"end"` holding [count text, bar frame (fixed height = round(plotH*count/max))]. Labels in a separate row below.
- Horizontal-bar chart (choice counts): row = fixed-width label + FIXED-width track ($muted, clip) with inner fill `width:round(track*count/max)` + fill_container count/pct text. Scale bar length to MAX count so the top option fills the track.
- RENDER LAG reconfirmed: Copy'd headers paint immediately; all freshly-Inserted body content renders BLANK in get_screenshot (one attempt each, moved on). snapshot_layout + batch_design id-maps are authoritative.

## CANVAS REORG into presentation domain bands (2026-07-24)
Repositioned all 38 top-level frames into 5 horizontal domain bands (x/y only, via Update — no Move).
Added 5 standalone section-title text nodes (Montserrat 800, fontSize 64, uppercase, $muted-foreground),
each at x=0, y=(band framesY - 120), aligned to the first frame of its band. Title ids: COMPONENT
LIBRARIES=KcdAz, PARTICIPANT APP=I6Udi3, ORGANISER CONSOLE=S7sfj, SUPPLIER PORTAL=j6pIPH,
CONCEPTS / ARCHIVE=Xe1pm. Horizontal step = frame width + 260 gap; band framesY = 200 / 5260 / 8660 /
11160 / 13660 (≥650 vertical gap using each band's tallest real height from snapshot_layout: Band0 ABOHr
4408, Band1 h3ak0 2744, Band2 PRDdG 1842, Band3 Q4fye 1850, Band4 CwVWw 1955).

### Final band map (band → frame names in order)
- Band 0 COMPONENT LIBRARIES (y=200): ABOHr (Component Library — Participant), kv6ot (Component Library — Composites & Shells)
- Band 1 PARTICIPANT APP (y=5260): u87N7 (Auth), L82AQr (Landing), h3ak0 (Onboarding), C313E (Profile),
  mm31G (Burner Profile), u7RSIJ (Directory), g5Uqfw (Create a camp), qhcHh (Join a camp), RGcNS (Camp
  Dashboard), ZyKzw (Camp Settings · Roles & Officers = roles settings), Hameq (Camp Questionnaires),
  qKG3g (Questionnaire Gate), uj2yF (Runner v2), RBIDd (Registration Wizard), P0Tcl (Registration Feedback),
  S8ZcWf (Mutant Vehicle Registration), d3pOJI (Art Project Registration), H7aIdg (Members — role chips, unmatched→end)
- Band 2 ORGANISER CONSOLE (y=8660): T7siQ9 (Gate — org wall), RTfFF (Org Status Board), StJXH
  (Registrations queue), PRDdG (Review), CJs0P (Accounts), iQEpd (Suppliers v2), g4CzsM (Categories),
  JY7dF (Org Questionnaires), sCEHP (Builder), AssNH (Builder v2), Mjiqz (Results v2), obd4x (Overview, unmatched→end)
- Band 3 SUPPLIER PORTAL (y=11160): Q4fye (Supplier Onboarding), R4wvO (Supplier Standing)
- Band 4 CONCEPTS / ARCHIVE (y=13660): cyMi6 (Camp Plot — Free/Unplotted), CwVWw (Camp Plot — Registered Mobile),
  OLb9g (Camp Plot — Registered Desktop), bi8Au (scratch Frame)

Notes: All 38 present, none dropped/duplicated. Two frames unmatched to the dispatched journey list were
appended to their most plausible band's end: H7aIdg (a members/roles card study, → Band 1 end) and obd4x
(older org Overview page superseded by RTfFF Status Board, → Band 2 end). problemsOnly = only the documented
phantom "+50px partially clipped" flags (cyMi6 Camp-Plot debris + new page-body frames) — ignorable. Spot
export of ABOHr/u87N7/T7siQ9 at scale 0.5 succeeded (repositioned frames render fine).

## 📱 PAIRING CONVENTION (Ryan, 24 Jul — canvas law)

Every PAGE frame gets a mobile sibling: "<Page> — mobile 360 · Dark", placed
immediately to the RIGHT of its desktop frame (x = desktop.x + 1400, same y). Band rows
are re-spaced to fit pairs (desktop, mobile, gap 260, next desktop...). Mobile rules:
360 wide · single column · ≥44px touch targets · title 24 / body 13 · padding 16-20 ·
full-width CTAs · slim header (small real-logo + avatar + full-width thin quilt band) ·
chip rows horizontally scrollable, clipped mid-chip · org mobile apricot, supplier
mobile sage. Libraries, card studies, and the archive band are exempt. When creating
any NEW page frame from now on, create its mobile pair in the same session.

## ACCOUNTS-SECURITY auth batch (Supplier signup/signin + Forgot-password) — 2026-07-24
### My frames
- Supplier Sign-up — /signup · Supplier Dark = **K3zNk** (Band 3 Supplier, x=3080, y=11160) — rendered PERFECT (quiet doc)
- Supplier Sign-in — /signin · Supplier Dark = **OX6KJ** (Band 3, x=4620, y=11160)
- Forgot Password — request & reset · Dark = **Gf1iJ** (Band 1 Participant end, x=27460, y=5260)
- All structurally verified via batch_get + snapshot problemsOnly (K3zNk clean; OX6KJ/Gf1iJ only the phantom +50/+60 "partially clipped" flag — height already fit_content; identical to K3zNk which is clean, so phantom). K3zNk screenshot confirmed the shared patterns; OX6KJ/Gf1iJ were newer and stayed in render-lag (header/band only) — non-blocking.
### Patterns
- Supplier auth header = Copy("v8TdCa", page, {descendants:{"O44Ho/p9ddJ":{fill:"$muted-foreground",fontWeight:"600"},"O44Ho/yxXDq":{fill:"$muted-foreground",fontWeight:"600"}}}). v8TdCa = Q4fye's Header (quilt band z4IE9 + AppShell Supplier O44Ho, sage SUPPLIERS tag + logo already swapped). Muting both nav items = correct signed-out state.
- Participant auth header = Copy("gqSjC", page) full-width quilt band + a 240x34 logo image frame (brand/afrikaburn-logo-banner-282.png) inside the region (mirrors u87N7 EEPpt treatment, no AppShell nav — recovery applies to all apps).
- Auth card = 440w, $card, radius12, pad32, gap16-18, outer shadow #00000033. Region = vertical alignItems center, top padding pushes card down.
- ONE-password-field w/ show toggle: input frame horizontal [value fill_container + lucide "eye"/"eye-off" icon]. Shown REVEALED with a memorable PASSPHRASE value ("tankwa-dust-and-diesel", "karoo-nights-are-cold") to reinforce the length-not-complexity, 15+ philosophy.
- Length-based strength bar (NOT complexity): track frame width fill_container h5 radius999 fill $muted clip:true layout:none + inner Fill frame fixed px width (312/300) fill $ab-sage (supplier) / $primary (participant). Meta row space_between: "At least 15 characters — passphrases welcome" muted 11.5 + "Strong" accent 11.5/700. NO complexity-rule checklist.
- Sage primary button: fill $ab-sage, label #17191B (dark) 14.5/700 — no sage Button component exists. Teal primary button: fill $primary, label $primary-foreground.
- Service category select = Copy("nn6iK",{descendants:{O71i4:{content:"Service category"},qx9UC:{enabled:false},b7Bq8:{content:"Stretch tents"}}}) + a sibling options-helper text listing all 6 (Stretch tents · Transport · Generators & power · Firewood · Sound & lighting · Other).
- Rules-ack with inline link: custom row (18px sage check box + label row ["I've read the" $foreground + "supplier basics ↗" $ab-sage underline]) — cleaner than OirYR/o6q8RQ when the label needs an embedded link.
- Enumeration-safe messaging: sign-in generic-error = muted $muted banner + info icon "If something doesn't match, we'll just say so — we never reveal which part" under an "EXAMPLE ERROR STATE" caption. Forgot-request confirmation = soft-teal (#2D769626) banner + circle-check "If that account exists, we've emailed it a reset link." under "AFTER YOU SUBMIT" caption.
- Forgot-password TWO stacked states in one frame via State Wraps: "① REQUEST A RESET LINK" label + card, "② SET A NEW PASSWORD" label + card. Reset card note "This signs you out everywhere…" = muted strip + lucide "log-out".

## 📱 MOBILE-360 batch — 17 remaining PARTICIPANT-APP page pairs (2026-07-24)

Built a mobile 360 sibling for every remaining page frame in the PARTICIPANT APP band (y=5260),
each at x = desktop.x + 1400. Skipped the 4 pre-existing pairs (EQW5G/Z2300W/TOUE1/D0LTCb) and the
H7aIdg card study (exempt). Three unlisted new Account pages (SjInE/G35eq/Q3pQj6, added by the
concurrent workflow into THIS band) were included per "every remaining page frame".

### New frames (name = id @ x, paired-to desktop)
- Sign up / Sign in — HCt1i @ 1400  ← u87N7
- Landing — R8zPnr @ 2940  ← L82AQr
- Profile — SdcDN @ 6020  ← C313E
- Burner Profile — lYUEe @ 7560  ← mm31G
- Create a camp — Evh1t @ 10640  ← g5Uqfw
- Join a camp — MttcT @ 12180  ← qhcHh
- Camp Settings · Roles & Officers — TIrbC @ 15260  ← ZyKzw
- Camp Questionnaires — YOdgW @ 16800  ← Hameq
- Runner v2 — M6JCN @ 19880  ← uj2yF
- Registration Wizard — XAJSe @ 21420  ← RBIDd
- Registration Feedback — QzpU6 @ 22960  ← P0Tcl
- Mutant Vehicle Registration — Qq5u0 @ 24500  ← S8ZcWf
- Art Project Registration — H2DP4 @ 26040  ← d3pOJI
- Forgot Password — s2PAS @ 28860  ← Gf1iJ
- Account · Manage — U6ixd @ 30400  ← SjInE
- Account · Security — JbB35 @ 31940  ← G35eq
- Account · Delete — Ur0rS @ 33480  ← Q3pQj6

### Patterns reused (this batch's recipe — very fast, mostly Copy)
- **Slim signed-in header** = `Copy("rZXLb", root, {name:"Header"})`. rZXLb (from the EQW5G pilot) =
  vertical [QuiltBand `a30rO` (layout:none, clip, height10, 3 full-1280 diamond paths teal/apricot/sage,
  opacity 0.9) + Bar (space_between, padding[12,16]) → 140px logo image frame + 32px `$secondary` avatar
  "AH"]. Override the avatar initials via `descendants:{I0Flc:{content:"DU"}}` when the page's person differs.
- **Signed-out logo-only header** (Auth/Landing/Join/Forgot) = build a vertical header, `Copy("a30rO")`
  for the band, then a Bar (justifyContent center or space_between) with a ~150px logo image frame
  (`fill:{type:"image",mode:"fit",url:"brand/afrikaburn-logo-banner-282.png"}`) + optional "Sign in" text.
- **Compress by Copy, not rebuild**: the desktop cards/content are almost all `width:"fill_container"`,
  so `Copy("<cardOrContentId>", body, {width:"fill_container", padding:18, descendants:{…}})` drops them
  straight into a 360 body (body padding [~22,16], gap ~18-20). Worked wholesale for Auth card (EEPpt),
  Profile cards (zxDzQ/g457WM/wSmyJ/S6a5z), Burner Profile Content (n7pJLW), Create-camp Form Card (g46AK),
  Join invite/expired cards, Runner question cards (attI9/fFVeT/XYrbp), Registration Wizard nav+section+
  submit (YYwgl/WTKig/kDSa7), Reg-Feedback sections (HmdmU), Vehicle/Art whole Content (TyfPc/vsYUk),
  Forgot cards (wBvAD/g6r17g), all 3 Account Inners (H7n8C/J34odI/r69ikm).
- **Copy descendants keys work on PLAIN (non-component) frames too**, keyed by the ORIGINAL child id —
  Copy remaps them. Verified retitling H1s (Kqekn/fH9hy/vowM6→fontSize24), shrinking display titles
  (jelg7/S5BcfR/AQsdB/WiFpJ), stacking submit rows (`{hxRUx:{layout:"vertical"}, <btn>:{width:"fill_container"}}`),
  and re-stacking the Delete two-col comparison (`{mYdQN:{layout:"vertical"}}`).
- Only ZyKzw (roles) + Hameq (questionnaire card) + Runner progress/footer were hand-rebuilt: the desktop
  role rows / member rows / steppers are wide horizontal `space_between` rows that can't compress. Rebuilt
  with a compact `roleRow` helper (vertical card: top row [emoji tile + name + lock + fill_container spacer +
  chevron], tags row, wrapping summary) and custom toggles (track 34×20 + 16 knob) per the roles recipe.
  Curated 8-key swatch palette + 🎩🔧🔥♻️🔊🧙 emoji (own $foreground text node) all reused from Roles v2.

### 🐛 Copied `space_between` rows OVERLAP at 360 (found via export, fixed)
Desktop key/value rows (Profile Bio Card `faHfK`) are horizontal `space_between` with a `fit_content` left
column whose VALUE text is `textGrowth:"auto"` (single-line, never wraps) + a right badge. At 1280 fine; at
360 the long values ("Hidden — someone at the burn", phone, "ALWAYS PRIVATE") overrun and sit UNDER the
badge. **snapshot_layout does NOT flag this** (auto-text overflow isn't a "problem") — only the export showed
it. FIX per offending row: set the L column `width:"fill_container"` + the value text
`{textGrowth:"fixed-width", width:"fill_container"}` (so it wraps in the freed space) and tighten row padding
[16,24]→[16,16]. Short-value rows were fine. Rule: when Copying a desktop `space_between` label/value/badge
row into 360, always wrap the value + fill_container the left column, and spot-check with an export (structure
verification alone misses text-overrun overlaps).

### Tooling notes
- Phantom "+50px partially clipped" on the fit-content body persists on MOST new pages even with explicit
  `height:"fit_content"` (Auth HCt1i + both Vehicle/Art came back fully clean; the rest flag it — ignorable,
  content is intact). Same +50 offset bug as every prior batch.
- Copied disabled tooltip node (gnTtE → `HmAKq`, enabled:false) emits the harmless "fill_container not inside
  flexbox" warning — ignore (it's disabled, won't render).
- **NO render lag this batch** — one export of Copy-based frames (HCt1i/SdcDN/Qq5u0, scale 1) rendered
  perfectly & immediately (Copy'd content always paints; doc was quiet). Used the single allowed export to
  catch the Bio-Card overlap above.

### Overlaps recorded for the task-#10 re-spacing pass
Desktops sit 1540 apart; a 360 mobile at desktop.x+1400 spans to desktop.x+1760, so EVERY pair overlaps its
right-neighbour desktop by ~220px (same as the 4 pilot pairs already did). Built in place as instructed; did
NOT reposition any neighbour. Only Account · Delete (Ur0rS @ 33480) has clear space to its right.

## ✅ TASK #10 — PARTICIPANT APP band re-spacing pass (2026-07-24)

Fixed the ~220px overlap: old desktop pitch was ~1540 while mobiles were added at desktop.x+1400
(mobile spans to +1760, overrunning the next desktop by 220). Re-spaced every top-level frame in
the y=5260 band into clean columns. New pitch = **2020** between consecutive desktops (desktop @ x,
its mobile @ x+1400 ending x+1760, next desktop @ x+2020 → **260 gutter**; desktop-end→mobile-start
gap = 120). Anchor u87N7 kept at x=0. Walked left→right in prior visual order; all y unchanged.
Reposition-only via `Update(id,{x})` — NO Move. 41 frames actually moved (u87N7 + HCt1i were already
correct at 0 / 1400).

### New column map (desktop id @ x  ·  mobile id @ x)
- u87N7 @ 0 · HCt1i @ 1400
- L82AQr @ 2020 · R8zPnr @ 3420
- h3ak0 @ 4040 · Z2300W @ 5440
- C313E @ 6060 · SdcDN @ 7460
- mm31G @ 8080 · lYUEe @ 9480
- u7RSIJ @ 10100 · D0LTCb @ 11500
- g5Uqfw @ 12120 · Evh1t @ 13520
- qhcHh @ 14140 · MttcT @ 15540
- RGcNS @ 16160 · EQW5G @ 17560
- ZyKzw @ 18180 · TIrbC @ 19580
- Hameq @ 20200 · YOdgW @ 21600
- qKG3g @ 22220 · TOUE1 @ 23620
- uj2yF @ 24240 · M6JCN @ 25640
- RBIDd @ 26260 · XAJSe @ 27660
- P0Tcl @ 28280 · QzpU6 @ 29680
- S8ZcWf @ 30300 · Qq5u0 @ 31700
- d3pOJI @ 32320 · H2DP4 @ 33720
- **H7aIdg @ 34340** (card study, w=1024, no mobile — own tighter slot: 1024+260 gutter, advance 1284)
- Gf1iJ @ 35624 · s2PAS @ 37024
- SjInE @ 37644 · U6ixd @ 39044
- G35eq @ 39664 · JbB35 @ 41064
- Q3pQj6 @ 41684 · Ur0rS @ 43084

### Verification
- snapshot_layout maxDepth=0 confirms **ZERO horizontal overlaps** across all 43 band frames: every
  consecutive gap is exactly 120 (desktop→own mobile) or 260 (mobile→next desktop, and both
  card-study gutters). Band now spans x=0..43444.
- Pairings verified two ways: recorded pen-lessons pairedTo ids AND x-math (every mobile was at its
  desktop's old x+1400). No structural check flagged anything; no export needed (positions authoritative).
- Other bands (COMPONENT LIBRARIES y=200, ORGANISER CONSOLE y=8660, SUPPLIER PORTAL y=11160,
  CONCEPTS/ARCHIVE y=13660) and band title I6Udi3 (x=0,y=5140) left untouched — confirmed unchanged x.

## 📱 ORGANISER CONSOLE band — re-spacing + mobile-360 batch (2026-07-24)

Re-spaced the y=8660 ORGANISER CONSOLE band onto the 2020 pitch and built a mobile 360
sibling for EVERY org page frame (13 pages, incl. the new Supplier Sign-up Management U7929T).
Anchor = T7siQ9 kept at x=0. Reposition-only via Update(id,{x}); no Move; y untouched; band
title S7sfj (x=0,y=8540) left alone. Only the SUPPLIER band (y=11160) was worked concurrently
by another agent — not touched here.

### Column map (desktop id @ new x  ·  mobile id @ x = desktop.x+1400)
- T7siQ9 @ 0        · E5Oip  @ 1400   (Gate — org wall)
- RTfFF  @ 2020     · w6X0wA @ 3420   (Org Status Board)
- StJXH  @ 4040     · NkPRL  @ 5440   (Registrations)
- PRDdG  @ 6060     · t4Ji4  @ 7460   (Review)
- CJs0P  @ 8080     · y1idvL @ 9480   (Accounts)
- iQEpd  @ 10100    · hSNjO  @ 11500  (Suppliers)
- g4CzsM @ 12120    · X8RHa  @ 13520  (Org Camp Categories)
- JY7dF  @ 14140    · XY8yO  @ 15540  (Org Questionnaires)
- sCEHP  @ 16160    · ELUfI  @ 17560  (Questionnaire Builder)
- AssNH  @ 18180    · ZBw8O  @ 19580  (Builder v2)
- Mjiqz  @ 20200    · nRtO7  @ 21600  (Results v2)
- obd4x  @ 22220    · pKW7z  @ 23620  (Overview)
- U7929T @ 24240    · D6IGel @ 25640  (Org Supplier Sign-up Management)

### Verification — ZERO horizontal overlaps
snapshot_layout maxDepth=0 confirms every consecutive gap in the band is exactly 120
(desktop→own mobile) or 260 (mobile→next desktop). Band spans x=0..26000. All 13 mobiles
present at desktop.x+1400, same y=8660. Each mobile passes snapshot_layout problemsOnly
= "No layout problems". One screenshot (y1idvL Accounts) rendered perfectly — validated the
slim header + stacked-table pattern; doc was quiet enough that the render-lag bug didn't bite.

### Reusable slim ORG mobile header = **t5SRc** (built in X8RHa, Copy'd into the other 12)
Header (vertical, fill_container) = Copy("pUEFw") mobile quilt band (full-1280 3-path band,
clip, height10) + Bar (space_between, padding[12,16], fill $card, strokeWidth{bottom:1}) →
[140×20 logo image frame (brand/afrikaburn-logo-banner-282.png)] + Right(gap9) → [apricot
"CONSOLE" pill (fill #F4B67226, radius999, pad[4,10], text $accent 10/700) + Copy("X1PTIY",
{width:32,height:32,fill:"$accent",descendants:{b5sb0Z:{content:"AB",fill:"$accent-foreground"}}})].
Reuse: `Copy("t5SRc", page)` drops the whole header (band+logo+tag+avatar) into each page — plain
frame Copy remaps all descendant ids, renders instantly. Slim header keeps NO nav (per pairing
convention); apricot accent preserved. Gate (E5Oip) uses a logo-only centered variant (no tag/avatar).

### Recipe: Copy the desktop Content, stack columns, override fixed widths
Most org pages Copy wholesale: `Copy("<ContentId>", page, {width:"fill_container", padding:[20,16],
descendants:{...}})`. Overrides applied:
- Horizontal multi-col groups → `{layout:"vertical", gap:16}` (RTfFF g0Hs3v, obd4x X1QOzU,
  PRDdG lSbeB, sCEHP cfIhy, AssNH wRL7a). Their fixed-width side columns → `{width:"fill_container"}`
  (iZn50 380, OWCvS 360, F0ItxR 380, J6oLEB 322, SYZQL 214, ks27x 540).
- Headline-tile rows → `{layout:"vertical"}` (RTfFF s5CXcH — 4 KPI tiles stack).
- space_between Page-Head rows with a CTA → `{layout:"vertical", alignItems:"start"}` + the button
  `{width:"fill_container"}` (JY7dF BAnr0/e5tbS full-width CTA).
- PRDdG Camp Header wide meta row (ze3BU, 4 metas + 3 interpunct dots, non-wrapping) → set ze3BU
  `layout:"vertical"` and disable the 3 dot texts (XvQLA/Yu5Lw/Ykn8O); H1 s3oA5 fontSize 28→22.

### Wide data tables → stacked card-per-row (reuses REAL data, no invention)
For the 3 real tables (Accounts agNHi, Suppliers e773Yw, Documents g1hWC0) I Copy the table frame
and pass a PROGRAMMATICALLY-BUILT descendants map (built with JS for-loops in batch_design before
the Copy — Copy remaps original ids): disable the Header Row; set each data Row (or its Summary
frame) `{layout:"vertical", alignItems:"start", gap:6-10}`; set the meaningful cells
`{width:"fill_container"}`; disable grip/expand/action-icon cells that don't matter on mobile
(e773Yw: also disabled the Desert Ablutions Expansion WJdpD). Each row becomes a clean stacked card.
Verified visually on y1idvL Accounts — reads great. Registrations (StJXH) uses the XqVPe **component**
(shadow ids unreachable for overrides) so I HAND-BUILT 5 compact reg cards (name + status Badge +
"SOOP Lx · New/Returning · Submitted date") from the known XqVPe seed data (Mad Hatters APPROVED,
Camp 404 UNDER REVIEW, Karoo Kombuis CHANGES REQUESTED, Dust Bunnies DRAFT, Long Drop Inn SUBMITTED).

### Fixed-width charts don't compress — dropped on mobile
RTfFF Status Board Left Column (hDasu = registration funnel 540-track + line chart 700-plot,
both precomputed-geometry fixed-width, mobile-hostile) → disabled on mobile. Kept the 4 KPI
tiles (stacked) + Right Column coverage cards (officer/questionnaire/supplier, fill_container —
their tracks fit 328, snapshot confirms no clipping) + Recent activity. Honest KPI-focused
mobile dashboard; noted the funnel/line-chart omission.

### Quirks
- Harmless "fill_container not inside flexbox" warnings on copied descendants (Tk86T, VsQNk,
  m6TDcu, EkMfM, P6Eg3, G8jqv0) — same ignorable class as prior batches; every affected frame
  passes snapshot_layout problemsOnly = "No layout problems".
- One "Collapsed size … zero" warning (tyFqD, e773Yw) = an emptied cell after stacking; invisible,
  no visual impact, snapshot clean.
- Every mobile page: width 360, height fit_content, clip:true, theme dark, fill $background.

## ✅ SUPPLIER PORTAL band — re-space (2020 pitch) + mobile-360 build (2026-07-24)

Ran the mobile-360 + re-spacing campaign on the SUPPLIER PORTAL band (y=11160). Re-spaced first
(Update x only, no Move, no y change, band title j6pIPH left alone), then built a mobile 360 sibling
for every supplier PAGE frame. Di3Zv (Supplier Documents 1024 card study) is EXEMPT — no mobile.

### Supplier band column map (desktop id @ x · mobile id @ x) — 2020 pitch, anchor Q4fye@0
- Q4fye (Supplier Onboarding) @ 0 · **lm3jO** @ 1400
- R4wvO (Supplier Standing) @ 2020 · **TXyLN** @ 3420
- K3zNk (Supplier Sign-up) @ 4040 · **h83pUG** @ 5440
- OX6KJ (Supplier Sign-in) @ 6060 · **xgCd7** @ 7460
- **Di3Zv** (Supplier Documents card study, w1024, no mobile) @ 8080 (tighter slot: width+260)
- Only R4wvO/K3zNk/OX6KJ/Di3Zv actually moved x (Q4fye was already the anchor @0). Band spans x=0..9104.
- ZERO horizontal overlaps confirmed (snapshot maxDepth=0): every gap is 120 (desktop→own mobile) or
  260 (mobile→next desktop, and the card-study gutter). All new mobiles snapshot problemsOnly = clean.

### Mobile build recipe (sage supplier accent preserved)
- **Slim supplier header** (built fresh per frame, not the desktop AppShell — nav too wide at 360):
  vertical [Copy of the desktop's quilt band z4IE9/ufAGC/ki2sw/M5gXGD (fill_container, 3 full-1280
  diamond paths) + Bar (space_between, padding[12,16]) → 140x20 logo image frame
  (brand/afrikaburn-logo-banner-282.png) + sage "SUPPLIERS" pill (fill $ab-sage, #17191B 10/700 label)].
- **Copy-the-Content recipe worked wholesale** — every supplier desktop card/field is width:fill_container,
  so `Copy("<Content>", root, {width:"fill_container", padding:[..,16,..,16], descendants:{…}})` dropped
  them straight into a 360 body. Q4fye: Copy OhlGV. R4wvO: Copy CMDFq. Auth pages: Copy the Auth Region
  (FQDNR/m903f) with the 440 card overridden to `{width:"fill_container", padding:20}` (the alignItems:
  center region + fill_container card = card spans 360). H1s dropped 28→24 via descendant fontSize.
- **space_between / multi-element rows stacked via descendant `layout:"vertical"` override** (the proven
  fix for the 360 overrun bug — pure property override, no rebuild, no overflow, snapshot-clean):
  - Q4fye: Progress top rRVfg→vertical (+D6Xsb alignItems start); Documents Panel head jMXyJ→vertical
    (+f3UIj auto→fixed-width fill_container so the sub wraps); all 4 doc rows CmqE4/fNWTt/I9VDCc/HO6oS
    →vertical (icon+info+ack+action would crush the fill_container info to ~14px otherwise); all 7
    step-card heads m7Uomb/PgLRd/e68hjH/OOyFb/gr1Sv/CrpcZ/vktWD →vertical (status32 + titles + wide
    badge like "AWAITING AFRIKABURN"/"AVAILABLE" overran; stacked reads fine: status chip / kicker+title / badge).
  - R4wvO: Standing Hero M2UQh→vertical (icon52 on top); 3 standing rows P1lsWu/Piozn/Nt57p→vertical
    (160px Label + Body); Contact yw0wl auto→fixed-width fill_container (email line would overflow).
- **Fixed-px progress fill must be rescaled**: Q4fye progress Fill eFfEa was width:562 (desktop 4/7 of a
  wide track); at a ~296 mobile track a 562 fill clips to 100%. Overrode eFfEa→width:165 (4/7 of mobile).
  (Auth strength-track inner fills 300–312px stay clipped-to-full = reads "Strong", matches the label; left as-is.)
- All 4 mobiles: root width 360, height fit_content, clip:false, theme dark, fill $background. Copy-based
  content painted immediately; no render lag this session (doc quiet). No export needed — structure authoritative.

### ⚠️ ISSUE — lm3jO (onboarding mobile) overflows DOWN into the CONCEPTS/ARCHIVE band
The onboarding mobile is 3938px tall (7 full step cards + docs panel stacked full-width at 360). At y=11160
its bottom = y15098, but the CONCEPTS/ARCHIVE band sits at y=13660 — so lm3jO (x1400-1760) vertically
overlaps the Camp-Plot archive frame CwVWw (x1540-1900) by ~220px wide × ~1438px tall. This is a BAND-SPACING
limitation, not a build error: the canvas-reorg y-gap (supplier→concepts = 2500px) was sized against Q4fye@2189,
before any 3900px mobile existed. Could not fix within scope — the campaign forbids changing y and forbids
touching other bands (CwVWw is an archive frame I don't own). RECOMMEND: push the CONCEPTS/ARCHIVE band (+ its
title Xe1pm) down ~1600px, or right-shift the archive band clear of the supplier mobiles. Flagged for Ryan/QA.
No other supplier mobile overflows (TXyLN/h83pUG/xgCd7 bottoms all < y13660; all desktops < y13349).

## Vertical band re-space (24 Jul, orchestrator)

Tall mobiles overflowed the old band y-positions (org t4Ji4 bottom 11694 > supplier 11160; supplier lm3jO bottom 15098 > archive 13660). Whole bands shifted down via Update y only:

- SUPPLIER PORTAL band: y 11160 → **12300** (title j6pIPH → 12180)
- CONCEPTS/ARCHIVE band: y 13660 → **16800** (title Xe1pm → 16680)

Verified via snapshot maxDepth=0: every band now starts ≥~440px below the previous band's max bottom. Current band map: components y=200 (bottom 4608) · participant y=5260 (bottom 8130) · org y=8660 (bottom 11694) · supplier y=12300 (bottom 16238) · archive y=16800. Rule going forward: when adding a tall frame, check band max bottom vs next band's title y and shift LOWER bands down (never squeeze the frame).

## QA lesson: thumbnails lie (24 Jul, after user caught residual jank)

Full-frame get_screenshot of anything taller than ~1100px is a THUMBNAIL — text-level defects (one-letter-per-line columns, badge/text collisions, mid-word email wraps) are INVISIBLE at that scale. The first QA sweep "verified" frames that were badly broken.

**Binding QA protocol:** for any frame taller than ~1100px, enumerate its Body's card/section children via batch_get and screenshot EACH section node individually. Frame-level screenshots are not acceptable evidence of correctness. Also: translucent-fill nodes (e.g. #C2443812 blocker cards) screenshotted in isolation composite on white and look ghostly/unreadable — that is an artifact, not a defect; verify those in situ on the parent.

Recurring mobile defect patterns found in the account area (all now fixed there):
- Auto-growth (non-wrapping) text in a fill_container column beside a fixed right element (date, badge, button) → overflows underneath it. Fix: textGrowth fixed-width + width fill_container on the text.
- A fixed-width element (150px QR) beside a fill column inside nested paddings starves the column to ~30px → one-letter-per-line. Fix: stack the row vertical on mobile.
- space_between heads with buttons ("Sign out everywhere") starve the title column. Fix: stack CardHead vertical on mobile.
- Long unbreakable tokens (emails) in narrow columns wrap mid-word. Fix: deliberate line break + smaller size, or restructure.

## Geometric audit protocol (25 Jul — after visual QA failed twice)

Eyes (mine and agents') missed text-level jank twice. The authoritative QA method is now GEOMETRIC:

1. `python3 scratchpad/penctl.py snapshot_layout '{"nodeId":"root","maxDepth":200}' full-layout.json` — full computed geometry of every node (penctl.py = raw JSONRPC client to the Windows bridge; recreate from design lessons if scratchpad is wiped).
2. BFS-crawl props via batch_get (15 ids per call, depth 3 — larger batches get elided to depth 1) → props-by-id.json.
3. `audit2.py` joins them: flags H/V-overflow of child vs parent box and sibling overlaps (any overlap in auto-layout parents; text-text overlaps in free layouts). Skips ≤12px quilt diamonds, disabled nodes, archive frames.

GOTCHAS:
- **snapshot_layout reports disabled nodes' stale as-if-enabled geometry** — both source-disabled and instance-override-disabled (descendants {X:{enabled:false}}). These are GHOSTS: verify visually once, then whitelist the shadow id in audit2.py DISABLED. Current whitelist covers the component annotation tags (below), AppShell wordmark PO6BC, switch label cols iaJYv/OJ2yq, supplier-nav VuubM/VU2a3, surplus tabs/pagination shadows, field help Tk86T.
- snapshot_layout ignores nodeId scoping in this bridge version — always dump root to a FILE via penctl, never inline (851KB).

ROOT CAUSE of the recurring "SELECTED/EMPTY/CLOSED text overlapping labels" everywhere: the library components (Check OirYR/o6q8RQ, Radio kfdhb, Field UIcOu, Textarea t8imVt/w9csgR, Select nn6iK/pMtGo) carried muted spec-annotation Tag/StateTag texts that rendered in EVERY instance and overflowed/overlapped at real widths. All disabled at source 25 Jul (AguQO, TWtJh, b6EsQ, eHwrS, oGd42, qx9UC, W1Z3Og). NEVER add annotation text inside a reusable component — annotate on the library sheet outside the component frame.

Result: 145 measured defects → 0 (plus 4 intentional scroll-chip overflows in D0LTCb). Full reports: scratchpad audit*-report.txt.

## The review harness is now in the repo (25 Jul)

The geometric audit graduated from scratchpad scripts to `design/qa/` — penctl.py +
audit.py + whitelist.json + REVIEW.md. REVIEW.md is the binding frame-review process
(decompose → measure → fix-by-property → targeted section screenshots last). The
scratchpad copies are dead; use the repo versions. audit.py filters disabled-node
ghost geometry via live props (source + descendants overrides), so no manual ghost
whitelisting — whitelist.json is only for verified-intentional design (with reasons).
