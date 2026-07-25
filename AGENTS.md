# AGENTS.md

Operating guide for AI agents (and humans) in this repo, distilled from how the
project actually runs. `README.md` has the product overview; the `docs/` specs are the
feature contracts. **Where anything conflicts, `docs/build-spec.md` wins for
engineering and this file wins for process.**

## What this is

The AfrikaBurn Contributors App ("Quagga Portal" — name still pending the working
group): a three-app Turborepo serving burners, the AfrikaBurn org, and suppliers.
Kickoff-driven, spec-first, public repo, MIT.

```
apps/web        participant app   :3000  (teal accent)
apps/org        organiser console :3001  (apricot — .org-accent)
apps/suppliers  supplier portal   :3002  (sage — .supplier-accent)
packages/       @quagga/{ui,db,core,types,eslint-config,typescript-config}
design/         ab-initial-app.pen (pen.dev canvas) + brand/ + pen-lessons.md
docs/           specs (law) + sources/ (mirrored corpora: quaggapedia, afrikaburn-org)
```

## Commands

```bash
pnpm turbo run lint typecheck test build   # THE gate — must be green before any commit
pnpm --filter @quagga/web dev              # or org / suppliers
pnpm --filter @quagga/db db:generate       # schema.ts → appended migration (offline)
```

## Hard engineering rules

1. **No migration step in any build script, ever.** Migrations are generated offline
   (`db:generate`), committed, and applied manually once a `DATABASE_URL` exists.
2. **Migrations are append-only.** Never edit or regenerate an existing migration;
   `packages/db/src/schema.ts` is the single source of truth.
3. **Pins that must not move**: `better-auth` = 1.4.18 exactly; `@radix-ui/react-slot`
   ~1.2.4. Newer versions break typecheck/build (documented breakages).
4. **All three apps must boot env-less** to a graceful "not configured" state. Never
   add code that crashes the build or boot without env.
5. `turbo` runs `typecheck` after `build` on purpose (Next generates `routes.d.ts`).
   A bare `tsc` in an app dir without a prior build may fail — that's expected.
6. **Prefer prebuilt components** (shadcn ecosystem first) over hand-rolling solved UI
   (phone inputs, accordions, toggle groups…). Hand-rolling solved problems is a defect.
7. TypeScript strict, no `any`; Zod validation on every server action/boundary;
   authz predicates live in `@quagga/core` and are enforced server-side (UI hiding is
   never the security boundary).
8. Vitest covers core logic; add regression tests with every bug fix.

## Product laws (violating these is a bug, not a style choice)

- **The platform never holds or processes money.** Registration is free — AfrikaBurn
  never charges theme camps. No payment UI in any registration context. Payment
  *reference tracking* exists only for future logistics apps. Camp-internal member ref
  codes (`MAH-M017`) are allowed — they're the camp's own EFT reconciliation.
- **Fewer forms, not more.** Every field must earn its place; derive over ask; carry
  forward by default; progressive disclosure over blanket collection.
- **Privacy hard-locks**: phone, emergency contacts, ID/passport are NEVER publicly
  exposable, regardless of flags. The ONLY path that shares a phone with the org is an
  accepted officer registration (explicit consent flow). Free camps are undiscoverable
  to strangers (directory, profiles, type-aheads all enforce this).
- **Structural roles (`lead`/`admin`) hold every project permission irrevocably** — the
  no-lockout backstop. Custom-role privileges are grants on top.
- **Out of scope, permanently unless Ryan says otherwise**: ticketing (Quicket's),
  placement maps, camp treasuries/dues.
- Blocking questionnaires are labeled explicitly everywhere and gate hard (fill page +
  sign-out only); org-internal questionnaires never leak into the participant app.

## Process

- **Design before build.** Every new feature gets pen.dev frames first; Ryan reviews;
  code starts after. When you create any new page frame, create its mobile 360 pair in
  the same session (pairing convention below).
- **Specs are contracts.** Feature behavior lives in `docs/*-spec.md`; update the spec
  when Ryan changes direction, then implement the spec. Sources of ground truth:
  `docs/sources/quaggapedia/` and `docs/sources/afrikaburn-org/` (mirrored corpora with
  INDEX files) — cite them rather than guessing event facts.
- **Adversarial verification.** Non-trivial builds end with independent review agents
  hunting authz holes, privacy leaks, and spec violations — findings get fixed with
  regression tests before pushing. This has caught real majors every time it ran.
- **Orchestration reports**: structured-output reports are pure JSON fields — never
  embed XML-ish tags inside strings (a known repeated failure mode).

## The design canvas (pen.dev)

`design/ab-initial-app.pen` is the design source of truth, edited via the pencil MCP
tools only. **Read `design/pen-lessons.md` before touching the canvas** — it is the
accumulated law: dialect (Camp Dashboard scaffolding, tokens-by-variable, library
instancing — 58+ reusable components, never redraw them), bridge quirks (the
`batch_design` arg is `input`; deep-read + filter `reusable:true` yourself; `Move()`
poisons a frame's render cache — build append-only, reposition top-level frames via
`Update x/y` only), the verification protocol (batch_get + snapshot_layout are
authoritative; a blank export right after edits is render-lag, not failure — one export
attempt, then move on), the domain-band layout, and the mobile pairing convention
(every page frame has a "— mobile 360" sibling at desktop.x + 1400).

**Reviewing design work**: never judge a frame by a full-frame screenshot — tall
frames render as unreadable thumbnails and visual QA has provably missed severe
defects that way. The binding review process is `design/qa/REVIEW.md`: decompose the
frame into a component manifest, run the geometric/style/content checks in
`design/qa/audit.py` (zero `[DEFECT]` tolerance, warnings dispositioned or
whitelisted-with-reason), and only then do targeted section-level screenshots.

**Saving**: the app writes to disk only when Ryan manually saves. Never assume the
`.pen` file on disk reflects live canvas state; ask Ryan to save before committing
design work, and never stage `design/ab-initial-app.pen` from a code-focused commit.

## Git

- Commit on `main` with explicit paths; imperative subjects explaining why; gate green
  first. Push after milestones (the orchestrator pushes; task agents usually don't).
- The repo is PUBLIC: no real personal contact data (supplier contacts are scrubbed on
  import), no naming real businesses in negative demo states (use fictional names like
  "LosKop Catering"), seeds use `@example.com` humans.
- History was rewritten once (24 Jul 2026) to purge unredacted originals — the
  `archive/source-documents` branch exists ONLY locally on Ryan's machine; never
  recreate or push it.

## Cast, for realistic copy

Camps: Mad Hatters (registered), Camp 404 (under review), Karoo Kombuis
(changes requested), Dust Bunnies, The Long Drop Inn, Vuurvlieg Collective, Stofpad
Saloon. Humans: Alice Hatter, Ren Notfound, Jabu (all fictional, @example.com).
Edition: AfrikaBurn 2027 · 26 April – 2 May 2027. Ref codes: `MAH-M017`. Suppliers:
real ones from the AB sheet (scrubbed) + fictional LosKop Catering (suspended demo).
