# AGENTS.md

Operating guide for AI agents (and humans) in this repo, distilled from how the
project actually runs. `README.md` has the product overview; the `docs/` specs are the
feature contracts. **Where anything conflicts, `docs/build-spec.md` wins for
engineering and this file wins for process.**

## What this is

The AfrikaBurn Contributors App ("Quagga Portal" — name still pending the working
group): a three-app Turborepo serving burners, the AfrikaBurn org, and suppliers.
Kickoff-driven, spec-first, public repo, **FSL-1.1-ALv2** (Functional Source License,
converting to Apache 2.0 two years after each release — see `LICENSE`).

```
apps/web        participant app   :3000  (teal accent)
apps/org        organiser console :3001  (apricot — .org-accent)
apps/suppliers  supplier portal   :3002  (sage — .supplier-accent)
packages/       @quagga/{auth,ui,db,core,types,eslint-config,typescript-config}
design/         ab-initial-app.pen (pen.dev canvas) + brand/ + pen-lessons.md
docs/           specs (law) + sources/ (mirrored corpora: quaggapedia, afrikaburn-org)
```

## Commands

```bash
pnpm turbo run lint typecheck test build   # THE gate — must be green before any commit
pnpm e2e:local                             # the OTHER gate — real DB, real browser
pnpm e2e:local specs/new-burner            # ...or one persona
pnpm --filter @quagga/web dev              # or org / suppliers
pnpm --filter @quagga/db db:generate       # schema.ts → appended migration (offline)
```

**The unit gate does not run a single browser.** `turbo run … test` lints and
typechecks `@quagga/e2e` but never executes Playwright, so the 141 persona specs
prove nothing until `pnpm e2e:local` runs them. It brings up Postgres + the two
Neon proxies (`docker-compose.local.yml`), migrates, seeds, boots all three apps
and runs the suite. **Run it for anything touching auth, sessions, privacy
projection, or the invite round trip** — a whole class of defect is invisible to
static analysis. The sign-up dead-end (a live session behind a "check your
inbox" message that no deployment without a mail provider could ever satisfy)
passed lint, typecheck, unit tests and build, and died on first contact with a
browser.

Two traps that already cost real time:

- **A long-lived `next dev` keeps a stale module graph.** Delete a file that
  something imports and the running server serves 500s *while `turbo build`
  stays green* — once producing 104 phantom E2E failures that read exactly like
  product bugs. `e2e:local` always restarts dev and aborts on
  `Module not found`. If you are running dev by hand, restart it after deleting
  or moving a module.
- **Local Postgres is not Neon.** The proxies are faithful enough to catch
  logic, not pooling behaviour or cold starts. Green locally is strong evidence,
  never proof for production.
- **Watch the disk, and do not undo `turbo.json`'s output excludes.** `.next/dev`
  holds unbounded Turbopack state. It was once counted as build output, so every
  build archived a fresh copy: about a dozen build-and-test cycles reached
  ~550 GB and filled a real machine. `!.next/dev/**` in `turbo.json` and the
  cleanup in `scripts/e2e-local.sh` are what stop it — both carry the incident in
  a comment. If you are running many build cycles, `df -h` occasionally.
- **Clean up git worktrees.** Agent runs that use `isolation: "worktree"` leave
  full checkouts behind; ten of them were once sitting at 2.3 GB. `git worktree
  list`, then `git worktree remove` what has finished.

## Hard engineering rules

1. **Migrations are generated offline, committed append-only, and applied
   automatically at deploy time by the advisory-locked runner.** Generate with
   `db:generate` (offline, from `schema.ts`); commit the file. At deploy, every app's
   `build` runs `db:migrate:deploy` (`packages/db/src/migrate.ts`) before `next build`:
   it takes a Postgres session advisory lock on the UNPOOLED connection so the three
   concurrent Vercel builds serialise safely, then applies any pending migrations
   (idempotent — drizzle's own table makes the losers no-ops). A migration is NEVER
   hand-edited, NEVER regenerated, and NEVER applied by an agent from a developer
   machine against production — the build is the only thing that applies them.
   **The UNPOOLED endpoint is mandatory and ENFORCED, not merely preferred**: the
   runner reads `DATABASE_URL_UNPOOLED` (Neon's direct endpoint) first, and it
   *aborts the build* rather than silently falling back to a pooled URL — because
   session advisory locks do not hold on Neon's PgBouncer (transaction-pooling)
   endpoint, which is what Neon's Vercel integration puts in `DATABASE_URL` by default.
   Specifically it fails hard if the resolved host is a `-pooler`/`pgbouncer` endpoint
   (any env), and, on a `VERCEL_ENV=production` deploy, if `DATABASE_URL_UNPOOLED` is
   unset at all or if no DB is configured at all (a production build that migrates
   nothing is a broken build, not a valid DB-less one). So Vercel env for each app
   must set **both** `DATABASE_URL` (pooled, for the app) and `DATABASE_URL_UNPOOLED`
   (direct, for the migrator). Non-production, non-pooler fallback still works (with a
   loud warning) for local dev / Neon Local.
   *(Ryan, 26 Jul 2026: this replaces the earlier "no migration step in any build,
   ever", which over-hardened the real constraint — don't migrate in the very first
   build, before any DB existed. Now that a DB exists, deploy-time migration is the law.
   Amended same day: fallback-to-pooled is a hard failure, not a warning.)*
2. **Migrations are append-only.** Never edit or regenerate an existing migration;
   `packages/db/src/schema.ts` is the single source of truth.
3. **Pins that must not move**: `better-auth` = **1.6.25 exactly** (a DIRECT dependency of
   `@quagga/auth`; verified React 19 / Next 16 / zod 4 / drizzle-orm 0.45.x compatible);
   `@radix-ui/react-slot` ~1.2.4 (newer breaks typecheck/build). *(Ryan, 26 Jul 2026: the
   old `better-auth = 1.4.18` pin lived in `pnpm.overrides` ONLY because better-auth was a
   transitive dep of managed Neon Auth and had to match Neon's internal version. Self-hosting
   (docs/auth-platform-spec.md) makes better-auth a first-class direct dependency, so the pin now
   lives as the exact version in `packages/auth/package.json` and the override was removed. 1.5+
   also unlocks versioned-secret rotation and the OAuth-provider path.)* **Never auto-bump
   better-auth**: it has a track record of high-severity auth advisories (GHSA-vp58-j275-797x,
   GHSA-8jhw-6pjj-8723) and we now own the CVE-patch watch — a critical CVE is the one reason to
   move the pin, done deliberately with the gate re-greened, not via Renovate/Dependabot.
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
- **Privacy classes** (two, both enforced in `@quagga/core` `privacy.ts`, never in
  the UI; both are excluded from EVERY public projection unconditionally):
  - **Hard-locked (`HARD_LOCKED_PRIVATE_FIELDS`)** — phone, both emergency contacts,
    SA ID and passport. NEVER publicly exposable and with **no reveal path of any
    kind**. The ONLY path that shares a phone with the org is an accepted officer
    registration (explicit consent flow).
  - **Safety-visible (`SAFETY_VISIBLE_FIELDS`)** — **medical notes only**. Never
    public either, but **visible** to the audience the burner disclosed them to: a
    camp lead/admin of a camp the burner is a member of (their OWN camp only; a lead
    of camp A is refused for a member of camp B) and org staff (`org_staff`/`god`).
    **The consent lives at the point of entry** — the medical field's own label says
    who can see it ("Your camp leads and AfrikaBurn's safety team can see this…",
    `MEDICAL_AUDIENCE_NOTE`, shown wherever medical is captured or edited). That
    honest label is the load-bearing privacy control, exactly as the paper form
    already works: if you disclose it, you consent to that audience holding it.
    There is **no reveal ceremony** — no reason prompt, no dialog, no per-view
    notification; friction in an emergency protects nobody. What remains, because it
    costs nothing and matters: **encrypted at rest**; **never in any public
    projection** (`canBePublic("medical") === false`, unconditional); **never in a
    list, roster, card or export** — only on a member's DETAIL view (`/burners/[id]`
    in `apps/web`, `/registrations/[id]/members/[userId]` in `apps/org`), because
    casual bulk exposure is a different risk from purposeful access; and **every
    disclosing read writes an `audit_events` row** (`bio.medical.view` — actor,
    subject, basis, timestamp) server-side via `after()`, so the audit never blocks
    or slows the read. That row is a **record, not monitoring**: it answers "who saw
    my medical information?" and lets an incident be reconstructed. Do **not** add
    volume thresholds, per-actor profiling or alerting on top of it — reading many
    members' notes in one sitting is ordinary safety work, and flagging it reports
    normal care as an incident while teaching staff the tool watches them.
    *(Ryan, 26 Jul 2026 — an enumeration detector was built and removed for exactly
    this reason.)* The authz predicate is
    `canViewMedicalNotes` (`@quagga/core` `medical-access.ts`), enforced server-side.
    *(Ryan, 26 Jul 2026: "if you disclose it, aren't you consenting to that audience
    to hold that data?" — this replaces both the earlier hard-lock and the
    short-lived break-glass/reason-prompt design.)*
  - Free camps are undiscoverable to strangers (directory, profiles, type-aheads all
    enforce this).
- **Structural roles (`lead`/`admin`) hold every project permission irrevocably** — the
  no-lockout backstop. Custom-role privileges are grants on top.
- **On the org side the same job is done by `memberships.role = 'god'`** (org roles v1,
  migration 0018): console permissions are now DATA — departments, roles and assignments a
  System manager creates — and a god resolves every capability whatever those rows say.
  `manage_accounts` is refused to every role by the resolver itself, and departments/roles/
  assignments are guarded on that anchor rather than on a capability, because the right to
  edit rights must not be grantable. Named lockout tests:
  `apps/org/lib/__tests__/org-role-lockout.test.ts`. The surface is **`/system/roles`,
  inside the System panel** (editing the permission model is "god level account
  management"): `read_system` to READ it, the anchor to CHANGE anything, and the
  people-affected data is not even queried for a reader. Anything that describes what an
  account may do — the accounts table, the assignment dialog, the role editor — renders
  `summarizeOrgActor` from @quagga/core, so the console can never advertise an access it
  would refuse, or understate one it would allow.
- **Out of scope, permanently unless Ryan says otherwise**: ticketing (Quicket's),
  placement maps, camp treasuries/dues.
- Blocking questionnaires are labeled explicitly everywhere and gate hard (fill page +
  sign-out only); org-internal questionnaires never leak into the participant app.
- **Seeds contain ONLY org-owned reference/catalog data** (edition, org group, camp
  categories, the two seeded org ROLES, the scrubbed supplier catalog, org questionnaire
  templates). Every burner,
  camp, membership, registration and questionnaire response — in **every** environment,
  including the kickoff demo — is created live through the app. No seeded accounts, ever.
  An empty directory / registrations queue on a fresh DB is the *correct* first-boot
  state; fix it with honest empty-state copy, never with a seeded row.
  *(Ryan, 26 Jul 2026. See `packages/db/src/seed.ts` header + `docs/deploy.md`.)*

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

**Saving**: the app writes to disk only when the canvas operator manually saves.
Never assume the `.pen` file on disk reflects live canvas state; ask them to save
before committing design work, and never stage `design/ab-initial-app.pen` from a
code-focused commit.

**One editor at a time, and it may not be you.** The canvas is no longer a
single-operator file — designers work on it too. `.pen` is ENCRYPTED, so git
cannot merge it: two parallel edits end with one person's work thrown away.
`.gitattributes` marks it `-merge` so git refuses rather than silently producing
a file Pencil cannot open. Before touching it, check nobody else has it (the
process is in CONTRIBUTING.md §"Designers: working on the canvas"), pull first,
and push the moment you stop.

## Git

- Commit on `main` with explicit paths; imperative subjects explaining why; gate green
  first. Push after milestones (the orchestrator pushes; task agents usually don't).
- The repo is PUBLIC: no real personal contact data (supplier contacts are scrubbed on
  import), no naming real businesses in negative demo states (use fictional names like
  "LosKop Catering").
- History was rewritten once (24 Jul 2026) to purge unredacted originals — the
  `archive/source-documents` branch exists ONLY locally on Ryan's machine; never
  recreate or push it.

## Cast, for realistic copy

**Design frames, mockups, docs and test fixtures only — never the seed** (see the
seeding law above). Camps: Mad Hatters (registered), Camp 404 (under review), Karoo
Kombuis (changes requested), Dust Bunnies, The Long Drop Inn, Vuurvlieg Collective,
Stofpad Saloon. Humans: Alice Hatter, Ren Notfound, Jabu (all fictional, @example.com).
Edition: AfrikaBurn 2027 · 26 April – 2 May 2027. Ref codes: `MAH-M017`. Suppliers:
real ones from the AB sheet (scrubbed) + fictional LosKop Catering (suspended demo).
At the live kickoff the "cast" is real: Ryan signs up as himself and registers Camp 404
through the wizard.
