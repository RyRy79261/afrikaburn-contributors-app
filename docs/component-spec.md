# UI Component Spec — composable primitives before pages

| Field | Value |
|---|---|
| **Category** | Engineering Spec |
| **Doc status** | Active |
| **Normative language** | Descriptive only |
| **Requirement IDs** | N/A — implementation detail; a UI component inventory is not directly derived from App Spec requirements |
| **Owner / Updated** | Ryan, 2026-08-05 |

_Ryan, 25 Jul 2026. Derived from the design canvas via the `design/qa` audit tooling
(component census: 62 reusable components in `ABOHr` + `kv6ot`, usage-ranked). Build
the primitives once in `@quagga/ui`, then assemble pages. §6b prefer-prebuilt is law:
shadcn/registry base first, styled to Tankwa Night tokens; hand-roll nothing solved._

## Tier 1 — form controls (highest instance counts on canvas)

| Component (canvas)                        | Uses  | Base                              | Notes                                                                                                           |
| ----------------------------------------- | ----- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Select (`nn6iK`/`pMtGo`)                  | 29+   | shadcn `select`                   | audience picker variant takes grouped options                                                                   |
| Field (`UIcOu`/`lycnH`)                   | 20+   | shadcn `label`+`input` wrapper    | label · control · help · error slots; per-field privacy toggle slot (Bio)                                       |
| Textarea + word count (`w9csgR`/`t8imVt`) | 23+   | shadcn `textarea`                 | count = derived, min/max words prop                                                                             |
| Check / Radio (`OirYR`/`o6q8RQ`/`kfdhb`)  | 35+   | shadcn `checkbox`/`radio-group`   | ack-row variant (icon + wrapping label ≥44px)                                                                   |
| Switch (`K86ztM`/`tvgss`)                 | 13    | shadcn `switch`                   | privacy variant: ON · PUBLIC / OFF · PRIVATE caps + hard-locked (ALWAYS PRIVATE) state                          |
| Input (`SVgkj`)                           | 6     | shadcn `input`                    | password variant: show-toggle, 15+ strength meter (no confirm-twice, per accounts spec)                         |
| Phone input                               | (Bio) | **prebuilt: shadcn-phone-input**  | country selector — already a repo component `packages/ui/src/components/phone-input.tsx`; verify against design |
| Toggle group / year chips                 | (Bio) | **prebuilt: shadcn toggle-group** | exists `toggle-group.tsx`; multi-select years-attended                                                          |

## Tier 2 — display & feedback

| Component                                                                             | Uses | Base                      | Notes                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button (9 variants incl. org accent)                                                  | 66+  | shadcn `button`           | variants: default/secondary/outline/ghost/link/destructive/org; sizes sm/default/lg/icon                                                                     |
| Badge (14 status variants)                                                            | 60+  | shadcn `badge`            | status enum → variant map (DRAFT…REJECTED); PENDING PAYMENT/RECONCILED/WAIVED reserved for logistics apps — build the map extensible, don't ship those three |
| Avatar (`X1PTIY`)                                                                     | 24   | shadcn `avatar`           | initials fallback only (no upload in MVP)                                                                                                                    |
| AppShell (`l99dum`/`jgbtP`)                                                           | 26   | custom (exists as layout) | + QuiltBand full-width; now includes **NotificationBell** (badge count)                                                                                      |
| Toast (`vNWxz`/`JMxY8`/`R43Oe`)                                                       | —    | shadcn `sonner`           | success/error/info styled                                                                                                                                    |
| Tooltip, Breadcrumb, Tabs, Pagination, Table Dense, Skeletons, EmptyState, GateScreen | low  | shadcn equivalents        | GateScreen = custom (blocking questionnaire gate + org wall)                                                                                                 |
| Wizard (`QWDKT`)                                                                      | 1    | custom                    | 6-section registration navigator; numbered sections ONLY here (flow red-line)                                                                                |
| DisabledHintTile (`e0EHD5`)                                                           | —    | custom, trivial           | "coming later" tiles                                                                                                                                         |

## Tier 3 — new for notifications/bulletins (this week's frames)

| Component                              | Base                                           | Notes                                                                                                            |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| NotificationBell                       | custom, small                                  | bell + unread badge; in AppShell + mobile headers                                                                |
| NotificationItem (`H9bn7`/`IDy9A`)     | custom row                                     | kind-icon map, unread dot, read state                                                                            |
| BulletinCard (`fulVI`)                 | shadcn `card` base                             | kicker, pin, audience chip, read-rate bar (org list)                                                             |
| PinnedBulletinBanner (`i3m1n`)         | custom, small                                  | dismissable; Camp Dashboard + recipient dashboards                                                               |
| **Markdown editor** (bulletin compose) | **prebuilt: minimal-tiptap** + tiptap-markdown | shadcn-registry Tiptap component, tokens-friendly, React 19 OK. Renderer: react-markdown + typography, sanitized |
| AudienceSelect                         | Select variant                                 | shared with questionnaire builder; resolves-to count line                                                        |

## Build order

1. tokens/globals already shipped (`packages/ui` Tankwa Night) — no changes
2. Tier 1 controls + Button/Badge (everything else composes these)
3. AppShell + NotificationBell (unblocks every page's chrome)
4. Tier 2 feedback (toasts, gates, wizard)
5. Tier 3 notification set + markdown editor
6. Then pages, per the frame index below

Definition of done per component: matches canvas dialect (tokens, no raw hex except
data-colors), Storybook-less visual check via the app's dev routes, unit test where
logic exists (word counts, strength meter, audience resolution display), a11y label
pass, and — for anything with layout risk — a `design/qa/audit.py` check of the
matching canvas component stays green.

## Page → canvas frame

Every page has a desktop frame and a mobile-360 sibling. This is the fastest
way from a route to its frame; `design/qa/audit.py --sections <frameId>` emits
that frame's component manifest.

### apps/web (participant)

| Page                                 | Desktop / mobile                         |
| ------------------------------------ | ---------------------------------------- |
| Landing                              | `L82AQr / R8zPnr`                        |
| Auth (sign up/in)                    | `u87N7 / HCt1i`                          |
| Onboarding (Burner Bio)              | `iCQgd / srY69`                          |
| Profile                              | `C313E / SdcDN`                          |
| Burner Profile (3rd-party)           | `mm31G / lYUEe`                          |
| Directory                            | `u7RSIJ / D0LTCb`                        |
| Create a camp                        | `g5Uqfw / Evh1t`                         |
| Join a camp (invite)                 | `qhcHh / MttcT`                          |
| Camp Dashboard                       | `RGcNS / EQW5G`                          |
| Registration Wizard                  | `RBIDd / XAJSe`                          |
| Registration Feedback                | `P0Tcl / QzpU6`                          |
| MV Registration                      | `S8ZcWf / Qq5u0`                         |
| Art Registration                     | `d3pOJI / H2DP4`                         |
| Camp Settings · Roles & Officers     | `ZyKzw / TIrbC`                          |
| Camp Questionnaires                  | `Hameq / YOdgW`                          |
| Questionnaire Runner v2              | `uj2yF / M6JCN`                          |
| Questionnaire Gate                   | `qKG3g / TOUE1`                          |
| Forgot Password                      | `Gf1iJ / s2PAS`                          |
| Account · Manage / Security / Delete | `SjInE·G35eq·Q3pQj6 / U6ixd·JbB35·Ur0rS` |
| Notifications                        | `X6YN3 / qLjMS`                          |
| Bulletin view                        | `R6l2G / d7HlH`                          |

### apps/org (console)

| Page                               | Desktop / mobile            |
| ---------------------------------- | --------------------------- |
| Org gate                           | `T7siQ9 / E5Oip`            |
| Overview                           | `obd4x / pKW7z`             |
| Status Board                       | `RTfFF / w6X0wA`            |
| Registrations queue                | `StJXH / NkPRL`             |
| Review (registration)              | `PRDdG / t4Ji4`             |
| Accounts (god elevate + org roles) | `uj1wp / Ctdgd`             |
| Suppliers                          | `iQEpd / hSNjO`             |
| Supplier Sign-up Mgmt              | `U7929T / D6IGel`           |
| Camp Categories                    | `g4CzsM / X8RHa`            |
| Org Questionnaires                 | `JY7dF / XY8yO`             |
| Questionnaire Builder v2           | `sCEHP·AssNH / ELUfI·ZBw8O` |
| Results v2                         | `Mjiqz / nRtO7`             |
| Bulletins list + Compose           | `QqnNq·U8CqE / laWqH·zW1uE` |
| Org Notifications                  | `xRjgy / Cb5MV`             |
| System management                  | `bNbLs / qhCyJ`             |
| Roles & departments                | `IXwNt / gsiE0`             |

### apps/suppliers

| Page                               | Desktop / mobile             |
| ---------------------------------- | ---------------------------- |
| Sign up / Sign in                  | `K3zNk·OX6KJ / h83pUG·xgCd7` |
| Onboarding checklist (+docs panel) | `Q4fye / lm3jO`              |
| Standing                           | `R4wvO / TXyLN`              |
| Notifications                      | `swSq4 / OSqoc`              |
