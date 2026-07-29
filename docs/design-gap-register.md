# Design-gap register

> ## ⚠️ THE 16 MAJORS ARE FIXED — this is an audit snapshot, not an open backlog
>
> *Checked against code 27 Jul 2026.* The repair pass landed and **every M1–M16 below
> still reads "TRACKED (new)" only because the register was never updated.* Do not
> pick work off it without re-checking; do not re-fix something already fixed.
>
> Spot-verified in code:
>
> | Major | Now |
> | --- | --- |
> | M1 profile sign-in literal | fixed — `describeSignInMethods(linkedAccounts)`, real provider data |
> | M3 no reply channel on section feedback | fixed — `section_review_replies` (migration 0014), wired both sides |
> | M4 · M5 MV/art forms lose carding | fixed — both forms carry the Card treatment |
> | M7 · M9 · M10 · M11 tables forced onto mobile | fixed — all four org tables use the shared `ResponsiveDataTable` |
> | M8 privilege change has no confirm step | fixed — `Dialog` confirmation in `account-actions.tsx` |
> | M12 missing grid question types | fixed — grids in `packages/types/src/questionnaire.ts` |
> | M13 no author preview | fixed — `components/questionnaires/questionnaire-preview.tsx` |
> | M14 bulletins can't reach suppliers | fixed — the `org_suppliers` audience in `@quagga/core` `audience.ts` |
> | M15 supplier code never shown in portal | fixed — rendered on supplier onboarding |
> | M16 results bars collapse on mobile | fixed — responsive results view |
> | M6 supplier sign-up mgmt unreachable | addressed differently: reachable from a console-landing tile, **deliberately not in the header nav** (the reason is commented at `apps/org/app/(console)/page.tsx:41`) |
> | M2 placement tile drawn available, built disabled | **the code is right, the frame is wrong.** Placement is permanently out of scope (AGENTS.md); the canvas should change, not the app |
>
> **What this file is still good for:** the method (it is the reference for how a
> design-vs-implementation audit is run), the frame node ids, and the MINORS backlog
> below, which has **not** been re-audited. Anything new belongs in a fresh audit.

The standing record of where the implementation diverges from the pen.dev design
canvas (`design/ab-initial-app.pen`). One row per real divergence, each carrying its
**frame node id** and/or **`file:line`** so any claim here can be checked against both
the canvas and the code.

## What this is / how it was produced

- **Method.** An independent, per-frame design-vs-implementation audit. For each frame
  pair (desktop + its `— mobile 360` sibling) an auditor pulled the design contract with
  `python3 design/qa/audit.py --sections <frameId>` (emits the full component manifest —
  every section, text node, component instance, disabled/hidden state), pulled exact copy
  where needed via Pencil `export_html` / `get_screenshot`, then read the corresponding
  route + components in the repo. Seven agents covered 46 frames across the three apps.
- **Adversarial spot-check.** A final pass re-audited six frames other agents had
  declared **matching**, defaulting to skepticism ("self-reported completeness has
  already failed on this project once"). It broke one open (Results v2 mobile bar
  collapse) and confirmed the rest.
- **Honest caveat.** This is a **static-analysis audit**. No page here has been run
  against real data. Findings are read off the manifest + source; runtime-only defects
  (real-data layout, async/empty transitions, actual mobile reflow) are inferred from
  the code, not observed. Treat mobile-risk and data-shape findings as high-probability,
  not proven.
- **Verification.** `pnpm turbo run lint typecheck test build` is green (23/23 tasks) as
  of this document. This register modifies **no** code.

## Summary

### Frames by status

| Status | Frames |
| --- | --- |
| matches | 23 |
| partial | 21 |
| diverged | 2 |
| **Total audited** | **46** |

> The merged audit JSON reports the aggregate `diverged: 2` but does not carry a
> per-frame status label for the 44 non-spot-checked frames, so *which* two frames are
> "diverged" is not individually recoverable from the output — only the count is. The
> six spot-checked frames are individually labelled (5 matches, 1 partial).

### Gaps by severity

| Severity | Count |
| --- | --- |
| blocker | 0 |
| major | 15 |
| minor | 50 |

> Plus the adversarial spot-check added **1 major** (Results v2 mobile bar collapse) and
> several minors on top of the 15/50 headline — folded into the tables below and marked
> `(spot-check)`.

### Gaps by kind

| Kind | Majors | Minors |
| --- | --- | --- |
| missing-interaction | 7 | 7 |
| mobile-risk | 4 | 1 |
| other | 2 | 10 |
| copy-mismatch | 0 | 17 |
| missing-section | 1 | 9 |
| missing-state | 0 | 5 |
| mock-data | 1 | 1 |
| **Total** | **15** | **50** |

---

## MAJORS

Disposition legend: **TRACKED (#n)** = maps to an existing task; **TRACKED (new)** =
belongs on the backlog, no ticket yet; **NEEDS RYAN** = product/design decision required
before anyone codes; **CANVAS-IS-WRONG** = the code is right and the *frame* should
change (see the dedicated section). Nothing is marked *FIXING NOW* — this register only
records; it changes no code.

### M1 · Profile "Sign-in" method is a hardcoded literal
- **Frame:** `C313E + SdcDN` (Profile) — frame shows `Google` sign-in with email `ren.notfound@gmail.com`.
- **Route:** `/profile` — `apps/web/app/profile/page.tsx:434`
- **Design:** the Account card's sign-in value reflects the user's real provider.
- **Code:** renders the literal string `"Email"` regardless of provider. The auth user
  object handed to this page exposes no provider field, so the value is never queried. A
  Google-OAuth burner sees the wrong sign-in method. (Same root defect as minor m23 on
  `/account`.)
- **Kind:** mock-data. **Disposition:** TRACKED (new) — needs the auth layer to expose a
  provider field to the page before this can be correct.

### M2 · Placement entitlement tile drawn available, built disabled
- **Frame:** `RGcNS + EQW5G` (Camp Dashboard) — tile `bY7gJ` "Tile Placement" with an
  `Available` badge (`tO3ZG`/`kZtyp`) and a CTA row (`TnHZe` = `JlupE` label + `bmTsr`
  arrow).
- **Route:** `apps/web/app/camps/[slug]/page.tsx:445-454`
- **Design:** Placement is an actionable/available entitlement for a registered camp,
  unlike the other five parked tiles.
- **Code:** rendered as a `DisabledHintTile` identical to the parked tiles; even when
  `camp.registered` it stays disabled with hint "placement application opens once
  AfrikaBurn confirms the process."
- **Kind:** missing-interaction. **Disposition:** **CANVAS-IS-WRONG** —
  `docs/build-spec.md:72` explicitly parks Placement as a disabled hint tile
  ("Placement & Art grants 'entitlement — process TBC'"). Spec wins; the frame is stale.
  See the canvas-is-wrong section.

### M3 · Registration feedback has no reply channel
- **Frame:** `P0Tcl + QzpU6` (Registration Feedback) — node `aYBCE` "Reply Box"
  (placeholder "Let the placement team know what you cha[nged]") in section `vPV82`
  "Reply", with a "Resubmit registration" footer.
- **Route:** `apps/web/app/camps/[slug]/registration/page.tsx` →
  `components/registration/registration-summary.tsx:287-314` (read-only thread) /
  `registration-wizard.tsx:351-377` (read-only warning block).
- **Design:** a per-section two-way channel — the camp can write a reply to a specific
  placement-team review comment.
- **Code:** the AB comment thread is strictly read-only in both surfaces. The camp can
  edit fields and resubmit but can never write a reply to a review comment. The two-way
  review conversation is absent everywhere.
- **Kind:** missing-interaction. **Disposition:** TRACKED — registration reply box needs
  a schema (a reply model on `section_reviews`). See "known deferred".

### M4 · Mutant-vehicle form loses the carded section system
- **Frame:** `S8ZcWf + Qq5u0` (Mutant Vehicle Registration) — all 6 sections drawn as
  elevated `$card` panels (`agZKq`/`Nsc8O`/`qtoSq`/`xOQ8P`/`ao1D4`/`t3kVu`; fill `$card`,
  `cornerRadius 12`, drop-shadow, padding 24).
- **Route:** `apps/web/app/vehicles/new/page.tsx` +
  `components/vehicles/vehicle-registration-form.tsx:64`
- **Code:** each section is a flat block separated only by a top border
  (`border-t border-border pt-6`). The carded visual system is lost.
- **Kind:** other (styling). **Disposition:** TRACKED (new).

### M5 · Art-project form loses the carded section system
- **Frame:** `d3pOJI + H2DP4` (Art Project Registration) — 5 sections as elevated `$card`
  panels (`FUY4i`/`bU3Vn`/`N8OIZc`/`hP00S`/`HQM1e`).
- **Route:** `apps/web/app/artworks/new/page.tsx` +
  `components/artworks/artwork-registration-form.tsx:57`
- **Code:** same `border-t border-border pt-6` flat sections as M4.
- **Kind:** other (styling). **Disposition:** TRACKED (new) — same fix as M4.

### M6 · Shipped Supplier-signup page unreachable + stale "Not built" tile
- **Frame:** `obd4x + pKW7z` (Overview) — node `cYXlB` draws "Supplier sign-up
  management" as a live quick-link tile.
- **Route:** `apps/org/app/(console)/page.tsx:203-213`
- **Design:** live quick-link into the supplier-signup page.
- **Code:** rendered as an inert `DisabledHintTile` tagged "Not built" / hint "page still
  in design" — but the page **is** fully built at
  `apps/org/app/(console)/suppliers/signup-management/page.tsx` (frame `U7929T/D6IGel`)
  and appears in **no** header nav (`console-header.tsx` omits it). A shipped page is
  reachable only by typing the URL; the comment is stale.
- **Kind:** missing-interaction. **Disposition:** TRACKED (new) — flip the tile live and
  add the nav entry.

### M7 · Registrations queue: desktop table forced onto mobile
- **Frame:** `StJXH + NkPRL` (Registrations queue) — mobile frame `NkPRL` abandons the
  table and stacks each registration into a card (`xr6zJ` "Registration Cards": name +
  inline status badge + meta line).
- **Route:** `apps/org/app/(console)/registrations/page.tsx:104-140`
- **Code:** the same 5-column shadcn `<Table>` on every viewport; at 360px it only
  scrolls horizontally (`packages/ui/src/components/table.tsx` wraps in
  `overflow-x-auto`). The designed mobile card layout is absent.
- **Kind:** mobile-risk. **Disposition:** TRACKED (new) — part of the shared table-mobile
  cluster (M7/M9/M10/M11/M16 + minor m37), one root cause.

### M8 · Privilege change has no confirm step
- **Frame:** `uj1wp + Ctdgd` (Accounts) — node `UPol9`: a Confirm Overlay titled
  "Elevate to org staff" with a "Who" subtitle, body copy, and Cancel / Confirm.
- **Route:** `apps/org/app/(console)/accounts/page.tsx` →
  `apps/org/components/account-actions.tsx:52-72`
- **Design:** privilege escalation/demotion is gated behind a confirmation dialog.
- **Code:** `setOrgStaffRole` fires immediately on the Elevate/Remove `onClick` (no
  `Dialog`/`AlertDialog` imported anywhere), success toast only. Accidental org-staff
  escalation or demotion has no guard.
- **Kind:** missing-interaction. **Disposition:** TRACKED (new) — safety gap; worth
  prioritising even though authz still enforces server-side.

### M9 · Accounts: desktop table forced onto mobile
- **Frame:** `uj1wp + Ctdgd` (Accounts) — mobile frame `Ctdgd` disables the header row
  and stacks each account into a card (Email / Name / Role / Action stacked).
- **Route:** `apps/org/app/(console)/accounts/page.tsx:78-127`
- **Code:** same 4-column shadcn `<Table>` on all viewports; with an action column it only
  scrolls horizontally at 360px.
- **Kind:** mobile-risk. **Disposition:** TRACKED (new) — shared table-mobile cluster.

### M10 · Suppliers: desktop table forced onto mobile
- **Frame:** `iQEpd + hSNjO` (Suppliers) — mobile frame `hSNjO` redraws each row (e.g.
  `D57Ra` "Row Karoo Structures") as a single 288px column (Supplier / Onboarding /
  Standing / Notes stacked).
- **Route:** `/suppliers` — `apps/org/app/(console)/suppliers/page.tsx` +
  `components/suppliers-table.tsx:37` (via `packages/ui/src/components/table.tsx:10`)
- **Code:** one 5-column shadcn `<Table>`; only `overflow-x-auto` on 360px.
- **Kind:** mobile-risk. **Disposition:** TRACKED (new) — shared table-mobile cluster.

### M11 · Supplier-doc table forced onto mobile
- **Frame:** `U7929T + D6IGel` (Supplier sign-up management) — mobile frame `D6IGel`
  stacks each document row (e.g. `QD5Dv` "Row 1") into a vertical card.
- **Route:** `/suppliers/signup-management` —
  `components/supplier-documents/documents-table.tsx:188`
- **Code:** 6-column shadcn `<Table>` that only scrolls horizontally at 360px.
- **Kind:** mobile-risk. **Disposition:** TRACKED (new) — shared table-mobile cluster.

### M12 · Two Google-Forms-parity grid question types missing
- **Frame:** `AssNH + ZBw8O` (Builder v2) — palette items `SJyVb` "PI Multiple-choice
  grid" + `HUkNj` "PI Checkbox grid".
- **Route:** `/questionnaires/new` + `/questionnaires/[key]/edit` —
  `components/questionnaires/block-kinds.ts:71-90` (PALETTE) + `block-editor.tsx`.
- **Code:** the PALETTE has neither; the `PaletteKind` union has no grid kind; grep for
  grid types returns nothing. The two types cannot be authored.
- **Kind:** missing-interaction. **Disposition:** TRACKED — grid question types. See
  "known deferred".

### M13 · No author preview of the questionnaire
- **Frame:** `AssNH + ZBw8O` (Builder v2) — Page Head TR has a "Preview" button
  (`ioCMq`) next to Send (`YP7yS`).
- **Route:** `components/questionnaires/builder-v2.tsx:457-482` (bottom action bar).
- **Code:** no preview control anywhere (grep "preview" hits only
  `previewAudienceCount`). Authors cannot preview as a respondent before sending.
- **Kind:** missing-interaction. **Disposition:** TRACKED — author preview mode. See
  "known deferred".

### M14 · Bulletins cannot be broadcast to suppliers
- **Frame:** `U8CqE + zW1uE` (Bulletin Compose) — audience picker lists a "Suppliers"
  option (desktop `U8CqE`/`nXMPZ`; mobile `zW1uE`).
- **Route:** `apps/org/app/(console)/bulletins/new/page.tsx` +
  `apps/org/components/bulletins/audience-options.ts:31-41`
- **Code:** `BULLETIN_AUDIENCE_OPTIONS` is built only from `ORG_OUTBOUND_SELECTORS` +
  `OFFICER_KEYS` + `org_internal`; the `AudienceSpec` vocabulary
  (`packages/types/src/audience.ts`) has **no** supplier selector/kind. Yet the supplier
  portal explicitly promises "AfrikaBurn bulletins broadcast to suppliers"
  (`apps/suppliers/app/(portal)/notifications/page.tsx:27`). The story is broken.
- **Kind:** missing-interaction. **Disposition:** TRACKED — supplier bulletin audience
  needs a resolver/selector. See "known deferred".

### M15 · Supplier reference code never shown in the portal
- **Frame:** `Q4fye + lm3jO` (Supplier Onboarding) — Progress panel shows a "SUPPLIER
  CODE" chip "SUP-2027-0416" (desktop `D6Xsb`/`qLSwP`/`dK6ZZ`; mobile `lm3jO`).
- **Route:** `apps/suppliers/app/(portal)/onboarding/page.tsx:74-111` +
  `apps/suppliers/lib/session.ts:118-122`
- **Code:** the progress card shows only title/description/bar; the portal session query
  never selects the column (`session.ts` selects `id,name,services,contact,website` — not
  `code`), though `suppliers.code` exists (`packages/db/src/schema.ts:818`) and is the
  human-quotable off-platform identifier.
- **Kind:** missing-section. **Disposition:** TRACKED (#8) — supplier code chip. See
  "known deferred".

### M16 (spot-check) · Results v2 bars collapse on mobile
- **Frame:** `Mjiqz + nRtO7` (Results v2) — mobile frame `nRtO7` draws proportionate bars
  (label 96px / track 98px / value 62px).
- **Route:** `apps/org/app/(console)/questionnaires/[key]/[activationId]/page.tsx` +
  `components/questionnaires/results-view.tsx:377` (w-40 label) & `:386` (w-28 value).
- **Code:** `BarRow` uses a fixed `w-40` (160px) label + `w-28` (112px) value with the bar
  as `flex-1`, no responsive override. At 360px the card inner width is ~320px; 160+112 +
  two `gap-3` = 296px fixed, leaving the bar track ~24px — effectively invisible. This
  guts the primary content of the Summary tab on phones.
- **Kind:** mobile-risk. **Disposition:** TRACKED (new) — quick CSS fix; same cluster as
  the table-mobile findings in spirit (fixed widths vs responsive).

---

## MINORS (backlog, not a plan)

Grouped by kind. Compact — the audit JSON carries the full prose for each.

### copy-mismatch (17)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m1 | `L82AQr` Landing | `apps/web/app/page.tsx:69,90-92` | Wordmark + hero rendered sentence-case; frame is ALL-CAPS ("QUAGGA PORTAL" / "YOUR CAMP, ONE PLACE."). Kickers do carry uppercase. |
| m3 | `iCQgd` Onboarding (was `h3ak0`) | `bio-flow.tsx:437-441` | Frame headline "Tell us who you are"; code "Your details" with different subtext. |
| m4 | `C313E` Profile | `profile/page.tsx:194-198` | Whole surface renamed "Your profile"; frame is "Your Burner Bio" throughout. |
| m7 | `mm31G` Burner Profile (public) | `profile-camps.tsx:114` | Badge reads "Self-reported"; frame labels it "FREE TEXT". |
| m8 | `mm31G` Burner Profile (public) | `profile-public/privacy-note.tsx:10-17` | Privacy note reworded (more verbose); same meaning. |
| m17 | `S8ZcWf` MV Registration | `vehicle-registration-form.tsx:67` | Step-number badge is a hollow muted circle; frame is a teal-filled pill. |
| m18 | `S8ZcWf` MV Registration | `vehicles/new/page.tsx:63` | Head status implies manual save; frame implies autosave ("Saved just now…"). |
| m22 | `Gf1iJ` Forgot/Reset | `forgot-password-form.tsx:43` | Confirmation is a plain text block; frame is a teal success banner with circle-check icon. |
| m25 | `Q3pQj6` Account · Delete | `account/delete/page.tsx:52` | "Kept-but-anonymised" item text swapped (registration/review history vs "Posts and comments"). |
| m29 | `R6l2G` Bulletin view | `bulletins/[id]/page.tsx:112` | Kicker rendered `text-accent`; frame is `$primary`/teal. |
| m30 | `T7siQ9` Org gate | `gate-screen.tsx:36-58` | Heading/body hierarchy inverted vs frame (all copy present). |
| m32 | `PRDdG` Review | `decision-panel.tsx:105-146` | Reject reason captured in a modal; frame is an always-visible inline cluster. Different placeholder text. |
| m33 | `uj1wp` Accounts | `account-actions.tsx:59-66` | Remove action is a ghost Button; frame is a text Link with icon. |
| m38 | `JY7dF` Org Questionnaires | `questionnaires/page.tsx:287-289` | Shows "{completed}/{sent}" only; frame also shows a percent number. |
| m43 | `Mjiqz` Results v2 | `[activationId]/page.tsx:113-116` | Emphasised figure is the percent; frame emphasises the raw count. |
| m44 | `U8CqE` Bulletin Compose | `packages/types/src/audience.ts:58` | Audience labels differ ("Theme camp leads" vs "All camp leads", etc.). Same intent. |
| m47 | `Q4fye` Supplier Onboarding | `(portal)/onboarding/page.tsx:83` | Progress copy "N/N done" + generic desc; frame is "N of 7 steps" + Supplier-Depot deadline reminder. |

### missing-section (9)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m2 | `u87N7` Auth | `auth/[...path]/page.tsx:30-44` | No AfrikaBurn brand mark above the auth card (frame `u87N7`/`HCt1i`). Card copy matches exactly. |
| m5 | `C313E` Profile | `profile/page.tsx:213-216` | Identity subline drops "4 burns · since 2019"; only home city shown. |
| m9 | `u7RSIJ` Directory | `directory/page.tsx:105-108` | Camp cards omit placement/location; `DirectoryEntry` (`lib/groups-store.ts:41`) has no placement field. |
| m10 | `u7RSIJ` Directory | `directory/page.tsx:121-162` | No "FROM REGISTRATION" chip sub-group and no "+7 more" overflow. |
| m11 | `RGcNS` Camp Dashboard | `camp-members.tsx:96-127` | Member rows have no avatar/initials circle (frame `peRXT`/`X49YrL`). |
| m34 | `iQEpd` Suppliers | `suppliers-table.tsx` notes column | Notes surfaced via `SupplierNotesDrawer`; frame draws the notes timeline inline in the expanded row. |
| m35 | `g4CzsM` Camp Categories | `categories-manager.tsx:186` | Adds a 4th "Sort" column + 4 action buttons; frame has 3 columns + 2 actions. |
| m41 | `AssNH` Builder v2 | `builder-v2.tsx:385-415` | Title/description split into a separate "Details" card; frame carries them in the Section 1 header block. |
| m49 | `Di3Zv` Supplier Documents | `documents-panel.tsx:131` | No filetype icon, no file/size/domain meta, no REQUIRED/OPTIONAL badge chip. |

### other (10)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m12 | `RGcNS` Camp Dashboard | `camps/[slug]/page.tsx:238` | Ref-code block rendered as a standalone banner; frame places it inside the Members card (`pJcf8`). |
| m13 | `RGcNS` Camp Dashboard | `camps/[slug]/page.tsx:394-414` | Extra "Questionnaires" card added to the main grid; frame's grid has only Members + Registration. |
| m16 | `S8ZcWf` MV Registration | `vehicle-registration-form.tsx:87` | All callouts use one generic Info icon; frame colour-codes (flame=warning, teal=info). |
| m20 | `d3pOJI` Art Registration | `artwork-registration-form.tsx:80` | Same callout icon/colour flattening as m16. |
| m24 | `G35eq` Account · Security | `account/security/page.tsx:171` | Security-event rows lose the frame's per-event coloured status dots. |
| m27 | `Q3pQj6` Account · Delete | `account/delete/page.tsx:152` | Blocker card uses warning (amber); frame is destructive red. |
| m28 | `X6YN3` Notifications | `notification-day-groups.tsx:21` | In-stream bulletins use the plain NotificationItem row; frame uses a distinct Bulletin Card (`fulVI`). |
| m40 | `sCEHP` Questionnaire Builder (older vision) | `builder-v2.tsx:103` | Single-select `AudienceSelect`; older frame draws a multi-select checklist. Superseded by `AssNH` — low confidence. |
| m42 | `AssNH` Builder v2 | `builder-v2.tsx:471-481` | Primary action is "Publish & choose audience" at the bottom; frame's "Send" sits top-right. |
| m48 | `swSq4` Supplier Notifications | `(portal)/notifications/page.tsx:111` | In-stream bulletins use the compact notif row; frame uses a full BulletinCard (`c0jyR`). |

### missing-interaction (7)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m15 | `RBIDd` Registration Wizard | `registration-wizard.tsx:578-595` | One SOOP radio only; frame draws a separate Yes/No "Amplified" toggle (`cZtt3`). Likely intentional merge (`packages/core/src/sound.ts:22`). |
| m19 | `d3pOJI` Art Registration | `artwork-registration-form.tsx:462` | Power-needs uses multi-select `CheckGroup`; frame is a single-select Radio (`kfdhb`). |
| m21 | `Gf1iJ` Forgot/Reset | `reset-password-form.tsx:85` | No strength bar/live label; `assessPassword()` only gates submit. |
| m26 | `Q3pQj6` Account · Delete | `delete-account-form.tsx:54` | Confirm-password input has no show/hide eye toggle (frame `RFpC0`/`b0zGab`). |
| m31 | `StJXH` Registrations queue | `registration-filters.tsx:135-140` | Camp-type toggle has 3 segments; frame draws a 4th `[disabled]` segment (label unreadable — low confidence). |
| m36 | `g4CzsM` Camp Categories | `categories-manager.tsx:222-239` | Reorder via up/down buttons, no drag grip. Consistent with app-wide pattern (undocumented here). |
| m45 | `U8CqE` Bulletin Compose | `packages/ui/src/components/audience-select.tsx` | Collapsed dropdown shows a count for the selected option only; frame shows all 7 options with per-option counts inline. |

### missing-state (5)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m6 | `C313E` Profile | `profile/page.tsx:266-279` | Owner view shows real phone/emergency contacts; frame masks them ("+27 82 ••• ••47", "Hidden — someone at the burn"). Defensible for owner-own-data. |
| m14 | `Hameq` Camp Questionnaires | `questionnaires/page.tsx:183-188` | Non-finding: code adds an appropriate `EmptyState` the frame doesn't draw; rest matches. |
| m39 | `JY7dF` Org Questionnaires | `questionnaires/page.tsx` cards | Reorganised into header + nested activation rows; justified by the multi-activation data model. |
| m46 | `OX6KJ` Supplier Sign-in | `suppliers/components/auth/sign-in-form.tsx:105` | Error is plain red `<p role="alert">`; frame is a bordered banner with info icon (`lUoF8`). |
| m50 | `Di3Zv` Supplier Documents | `documents-panel.tsx:120` | Ack label has no "Acknowledged {date}" timestamp (frame `xNi7u`), though the ack row stores one. |

### mobile-risk (1)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m37 | `g4CzsM` Camp Categories | `categories-manager.tsx:181` | 4-column table + 4 action buttons horizontally scrolls at 360px; frame keeps a narrow 3-column row. Same root cause as M7/M9/M10/M11/M16. |

### mock-data (1)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| m23 | `SjInE` Account · Manage | `account/page.tsx:186` | `googleEmail={null}` hardcoded, so the Google row can only ever say "Connected." — the linked address the frame promises (`S17Cz`) is dropped. `listLinkedAccounts` (`lib/account.ts:152-181`) doesn't expose a provider email. Same root as M1. |

### spot-check additions (minors)

| # | Frame | Where | Gap |
| --- | --- | --- | --- |
| sc1 | `uj2yF` Runner v2 | `field.tsx:437`; `QuestionOption` type | Options have no per-option description/subtitle line; `QuestionOption` (`packages/types/src/questionnaire.ts:70-76`) has no description field, so it can never render. |
| sc2 | `RTfFF` Status Board | `registration-funnel.tsx:34` | Funnel final stage labelled "Approved"; frame reads "Approval". Cosmetic. |
| sc3 | `X6YN3` Notifications | `packages/ui/src/components/notification-item.tsx:127` | Blocking flag is inline text, not a right-aligned "REQUIRED" pill; frame's "No consent required" badge has no data backing (low confidence). |

---

## Canvas is wrong, not the code

Cases where the implementation is **right** and the **frame** should be updated. Each is
a deliberate deviation with a spec citation and/or an in-code comment.

1. **Placement entitlement tile (M2).** Frame `RGcNS`/`bY7gJ` draws Placement as an
   available tile with a CTA. `docs/build-spec.md:72` explicitly parks it: *"Placement &
   Art grants 'entitlement — process TBC'"* as a **disabled hint tile**. The spec is the
   engineering contract and it post-dates the frame. Code
   (`apps/web/app/camps/[slug]/page.tsx:445-454`) is correct; the frame is stale and
   should be redrawn as a disabled tile.

2. **Budget entitlement tile.** Frame draws Budget among the entitlement tiles; code
   renders it as a disabled "Exploring" hint with a **code comment**
   (`camps/[slug]/page.tsx`, the `PENDING RYAN'S RULING` block above the Budget tile)
   citing the product law that AfrikaBurn never runs camp treasuries/dues
   (`AGENTS.md` §Product laws — treasuries/dues are out of scope "permanently unless Ryan
   says otherwise"). Code is right; do not build a budget feature behind this tile.

3. **Registration CTA gated to `theme_camp`.** Frame draws the register CTA generally;
   code gates it to `theme_camp` only (`camps/[slug]/page.tsx:368-388`, documented
   comment) because MV and artwork projects register through their own dedicated forms —
   letting the camp wizard write those would overwrite their fields. Code is right.

4. **Account display-name is edited in the bio, not inline.** Frame draws an inline
   display-name editor on `/account`; code renders an "Edit in your bio" link
   (`apps/web/app/account/page.tsx:31-33`, documented comment: the bio owns the display
   name — *"two writers for one field is how they drift apart."*). Single-writer
   discipline; code is right, frame should reflect the link.

5. **Honest empty states over invented data (not strictly "canvas wrong", but code
   deliberately deviates):**
   - Status Board omits the "Registrations over time" chart (frame `rZlJy`, drawn
     unconditionally) when there is <2 months of real `submitted_at` history
     (`apps/org/app/(console)/status/page.tsx`, comment) — omitted rather than drawn over
     invented points.

   These are drawn "populated" in the canvas; the code chooses truthful empty/parked
   states. If the canvas is meant to be the literal contract, these frames should gain
   their empty-state variants; otherwise the code is right as-is.

---

## Known deferred, already tracked

So nobody re-discovers these — audit findings that map onto existing tasks or already
carry a spec/schema dependency.

| Audit finding | Frame / file:line | Tracked as |
| --- | --- | --- |
| ~~Wranglers coverage card parked (no wrangler-assignment data model)~~ | Overview `vb2fY`; `apps/org/app/(console)/page.tsx` | **CLOSED 29 Jul 2026** — migration 0026 `wrangler_assignments`; the tile is `WranglerCoverageCard` over real counts and the board is `/wranglers` |
| ~~MV / art registrations cannot be re-edited & resubmitted through the camp wizard (gated to `theme_camp`)~~ | `camps/[slug]/page.tsx`; MV/art forms | **CLOSED** — `/artworks/[slug]/edit` + `/vehicles/[slug]/edit` run each kind's own submit gate; covered by `specs/new-burner/art-and-vehicle-registration.spec.ts` |
| Supplier reference code chip never surfaced (M15) | `Q4fye`/`D6Xsb`; `onboarding/page.tsx:74`, `session.ts:118`, `suppliers.code` @ `schema.ts:818` | **#8 supplier code chip** (`docs/accounts-security-spec.md:171`) |
| Registration feedback reply box (M3) | `P0Tcl`/`aYBCE`; `registration-summary.tsx:287-314` | **Needs schema** — a reply model on `section_reviews`; append-only migration required |
| Bulletins to suppliers (M14) | `U8CqE`/`nXMPZ`; `audience-options.ts:31`, `packages/types/src/audience.ts` | **Needs a supplier audience resolver/selector** — new `AudienceSpec` kind + resolver |
| Grid question types (M12) | `AssNH`/`SJyVb`,`HUkNj`; `block-kinds.ts:71-90` | **Grid question types** — new `PaletteKind` + block editor + results aggregation |
| Author preview mode (M13) | `AssNH`/`ioCMq`; `builder-v2.tsx:457-482` | **Author preview mode** — respondent-view preview before Send |
| "View all"/"View audit log" links omitted on Overview + Status Board recent-activity | `OJMGq` / `XcpZ3`; `recent-activity.tsx`, `status/page.tsx` | Deferred — no audit-log page exists yet; links ship when one does (documented) |

### Table-mobile cluster (one root cause, several tickets)

M7, M9, M10, M11, and minor m37 (plus M16's fixed-width analogue) all stem from the same
thing: data tables render one shadcn `<Table>` wrapped in `overflow-x-auto`
(`packages/ui/src/components/table.tsx:10`) on every viewport instead of reflowing to the
stacked-card layouts the mobile frames draw. A single responsive table/card primitive in
`@quagga/ui` would close all of them at once.
