# UI Component Spec — composable primitives before pages

*Ryan, 25 Jul 2026. Derived from the design canvas via the `design/qa` audit tooling
(component census: 62 reusable components in `ABOHr` + `kv6ot`, usage-ranked). Build
the primitives once in `@quagga/ui`, then assemble pages. §6b prefer-prebuilt is law:
shadcn/registry base first, styled to Tankwa Night tokens; hand-roll nothing solved.*

## Tier 1 — form controls (highest instance counts on canvas)

| Component (canvas) | Uses | Base | Notes |
|---|---|---|---|
| Select (`nn6iK`/`pMtGo`) | 29+ | shadcn `select` | audience picker variant takes grouped options |
| Field (`UIcOu`/`lycnH`) | 20+ | shadcn `label`+`input` wrapper | label · control · help · error slots; per-field privacy toggle slot (Bio) |
| Textarea + word count (`w9csgR`/`t8imVt`) | 23+ | shadcn `textarea` | count = derived, min/max words prop |
| Check / Radio (`OirYR`/`o6q8RQ`/`kfdhb`) | 35+ | shadcn `checkbox`/`radio-group` | ack-row variant (icon + wrapping label ≥44px) |
| Switch (`K86ztM`/`tvgss`) | 13 | shadcn `switch` | privacy variant: ON · PUBLIC / OFF · PRIVATE caps + hard-locked (ALWAYS PRIVATE) state |
| Input (`SVgkj`) | 6 | shadcn `input` | password variant: show-toggle, 15+ strength meter (no confirm-twice, per accounts spec) |
| Phone input | (Bio) | **prebuilt: shadcn-phone-input** | country selector — already a repo component `packages/ui/src/components/phone-input.tsx`; verify against design |
| Toggle group / year chips | (Bio) | **prebuilt: shadcn toggle-group** | exists `toggle-group.tsx`; multi-select years-attended |

## Tier 2 — display & feedback

| Component | Uses | Base | Notes |
|---|---|---|---|
| Button (9 variants incl. org accent) | 66+ | shadcn `button` | variants: default/secondary/outline/ghost/link/destructive/org; sizes sm/default/lg/icon |
| Badge (14 status variants) | 60+ | shadcn `badge` | status enum → variant map (DRAFT…REJECTED); PENDING PAYMENT/RECONCILED/WAIVED reserved for logistics apps — build the map extensible, don't ship those three |
| Avatar (`X1PTIY`) | 24 | shadcn `avatar` | initials fallback only (no upload in MVP) |
| AppShell (`l99dum`/`jgbtP`) | 26 | custom (exists as layout) | + QuiltBand full-width; now includes **NotificationBell** (badge count) |
| Toast (`vNWxz`/`JMxY8`/`R43Oe`) | — | shadcn `sonner` | success/error/info styled |
| Tooltip, Breadcrumb, Tabs, Pagination, Table Dense, Skeletons, EmptyState, GateScreen | low | shadcn equivalents | GateScreen = custom (blocking questionnaire gate + org wall) |
| Wizard (`QWDKT`) | 1 | custom | 6-section registration navigator; numbered sections ONLY here (flow red-line) |
| DisabledHintTile (`e0EHD5`) | — | custom, trivial | "coming later" tiles |

## Tier 3 — new for notifications/bulletins (this week's frames)

| Component | Base | Notes |
|---|---|---|
| NotificationBell | custom, small | bell + unread badge; in AppShell + mobile headers |
| NotificationItem (`H9bn7`/`IDy9A`) | custom row | kind-icon map, unread dot, read state |
| BulletinCard (`fulVI`) | shadcn `card` base | kicker, pin, audience chip, read-rate bar (org list) |
| PinnedBulletinBanner (`i3m1n`) | custom, small | dismissable; Camp Dashboard + recipient dashboards |
| **Markdown editor** (bulletin compose) | **prebuilt — see platform research** | candidates: minimal-tiptap / novel / mdxeditor; decision recorded in docs/platform-architecture-spec.md once research lands. Renderer: react-markdown + tailwind typography, sanitized |
| AudienceSelect | Select variant | shared with questionnaire builder; resolves-to count line |

## Build order

1. tokens/globals already shipped (`packages/ui` Tankwa Night) — no changes
2. Tier 1 controls + Button/Badge (everything else composes these)
3. AppShell + NotificationBell (unblocks every page's chrome)
4. Tier 2 feedback (toasts, gates, wizard)
5. Tier 3 notification set + markdown editor
6. Then pages, per docs/page-build-plan.md

Definition of done per component: matches canvas dialect (tokens, no raw hex except
data-colors), Storybook-less visual check via the app's dev routes, unit test where
logic exists (word counts, strength meter, audience resolution display), a11y label
pass, and — for anything with layout risk — a `design/qa/audit.py` check of the
matching canvas component stays green.
