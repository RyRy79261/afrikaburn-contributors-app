# AfrikaBurn Contributors App

_Working name: **Quagga Portal**_

A platform for AfrikaBurn theme camps and the people who run the burn. It replaces a
patchwork of Google Forms, WhatsApp threads and spreadsheets with one place where a
burner has an account, a camp has a profile, a camp registers for an edition, and
AfrikaBurn staff review what comes in.

**Licence: [FSL-1.1-ALv2](LICENSE)** — Functional Source License, converting to
Apache 2.0 two years after each release. Use it, read it, build on it; don't ship a
competing product from it in the meantime.

> **Read [`AGENTS.md`](AGENTS.md) before changing anything.** It is the binding
> operating guide — hard engineering rules, product laws, and process. This README is
> orientation; AGENTS.md is law. Feature contracts live in [`docs/`](docs/).

---

## What's built

Three apps in one Turborepo, each its own Vercel project against one shared database
(see [`docs/deploy.md`](docs/deploy.md)):

| App              | Port | Accent  | Who it's for                                                              |
| ---------------- | ---- | ------- | ------------------------------------------------------------------------- |
| `apps/web`       | 3000 | teal    | Burners — bio onboarding, camp directory, camps, invites, registration    |
| `apps/org`       | 3001 | apricot | AfrikaBurn staff — review queue, accounts, suppliers, audit, `/system`    |
| `apps/suppliers` | 3002 | sage    | Camp suppliers — self-registration, onboarding steps, documents, standing |

Shared packages under the `@quagga/` namespace:

```
packages/auth    self-hosted Better Auth 1.6.25 config, mounted by all three apps
packages/core    pure domain logic + every authz predicate (the security boundary)
packages/db      Drizzle schema + append-only migrations + the deploy migrator
packages/types   Zod schemas and shared types
packages/ui      shadcn components and the Tailwind v4 token layer
packages/{eslint-config,typescript-config}
```

Working today: sign-up/sign-in (email+password, Google, 2FA, passkeys), the Burner
Bio onboarding flow, self-created camps with invites and roles, the six-section
registration wizard and the org review loop, camp/org questionnaires, bulletins and
notifications, the supplier repository and portal, camp-category taxonomy, the audit
trail, the org System panel, and the in-app reporter (below).

Not built: container transport, water/ice/gas logistics, offline QR attestations,
placement maps, payment processing. See [`docs/roadmap.md`](docs/roadmap.md).

## Getting it running

Requires Node ≥ 22, pnpm 10, and Docker (for the local database).

```bash
pnpm install

# 1. Local database: Postgres 16 + the two Neon proxies the app drivers need
docker compose -f docker-compose.local.yml up -d

# 2. Migrate and seed reference data
pnpm --filter @quagga/db db:migrate:deploy
pnpm --filter @quagga/db db:seed

# 3. Run everything (or one app with --filter @quagga/web | org | suppliers)
pnpm dev
```

Set env from `.env.example`. The apps talk to Neon through
`@neondatabase/serverless`, which uses **two** protocols — SQL-over-HTTP for the
stateless driver and WebSockets for the pooled one — which is why the compose file
runs a proxy for each in front of a plain Postgres. Point both at it with:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/quagga
DATABASE_URL_UNPOOLED=postgres://postgres:postgres@localhost:5432/quagga
NEON_LOCAL_PROXY=1
```

**All three apps boot with no env at all**, to a graceful "not configured" state.
That is a hard rule ([`AGENTS.md`](AGENTS.md) §4), not a convenience.

There are **no seeded accounts, in any environment.** The seed carries only
org-owned reference data — the edition, the org group, camp categories, the
scrubbed supplier catalog, one questionnaire template. An empty directory on a
fresh database is the correct first-boot state. Sign up through the app like a real
person; put yourself on `GOD_EMAILS` to reach the org console.

**Reaching the org console locally takes one extra step**, and it will stop you dead
otherwise: `god` is granted only to a `GOD_EMAILS` address that is **verified**, and
with no mail provider locally nothing can verify one. Sign up normally, then flip the
flag by hand — the recipe is in [`e2e/README.md`](e2e/README.md) §"Google & god
access". Every rank above that is granted through the real Accounts UI.

## The two gates

```bash
pnpm turbo run lint typecheck test build --concurrency=1   # THE gate
pnpm e2e:local                                             # the OTHER gate
pnpm e2e:local specs/new-burner                            # ...or one persona
```

**The unit gate never runs a browser.** It lints and typechecks `@quagga/e2e` but
executes no Playwright, so the persona suite — 153 tests across 56 spec files and 8
personas (`anon`, `new-burner`, `camp-member`, `camp-lead`, `officer`, `org-staff`,
`god`, `supplier`) — proves nothing until `pnpm e2e:local` runs it. That script
brings the stack up from cold: Docker, migrate, seed, all three dev servers, then the
suite. Run it for anything touching auth, sessions, privacy projection or invites; a
whole class of defect is invisible to static analysis.

Read [`e2e/README.md`](e2e/README.md) before writing or editing a spec — it documents
the selector traps that each cost a real debugging session.

## Database changes

Edit `packages/db/src/schema.ts`, then:

```bash
pnpm --filter @quagga/db db:generate    # appends a new migration file
```

**Migrations are append-only.** Never hand-edit or regenerate a committed one. The
latest is `0017` (org departments). They are applied **at deploy** — every app's
`build` runs `db:migrate:deploy` first, taking a Postgres advisory lock on the
**unpooled** connection so three concurrent Vercel builds serialise safely. That same
runner **bootstraps the reference data** when it finds an empty `editions` table, so a
brand-new database comes up usable rather than showing "preview mode" on every page.
It is a bootstrap, not a sync: a database that already has an edition is left alone.

## Auth

**Self-hosted Better Auth 1.6.25**, configured once in `packages/auth` and mounted by
each app at `/api/auth/[...all]` against our own Postgres. Managed Neon Auth was
removed (migration 0013 brought the auth tables in-house).

Shipped: email+password, Google OAuth, email verification (derived from whether a
mail provider is configured), password reset, **TOTP 2FA with encrypted backup
codes**, **passkeys** (both migration 0015), session listing and revocation, DB-backed
rate limiting, and cross-subdomain SSO so one sign-in carries across app/org/suppliers
on the apex.

`better-auth` is pinned to **1.6.25 exactly** and must never be auto-bumped — see
AGENTS.md §3 for why. `AUTH_CAPABILITIES` in `packages/core` is the machine-readable
record of what the provider supports; nothing may fake an unsupported capability.

## Identity, privacy and money — the parts most often got wrong

**Username.** `users.username` (migration 0016) is the burner's one public handle:
account-level, unique case-insensitively, 3–20 chars, **optional**. It is an alias,
not an identity anchor — rules live in `packages/core/src/username.ts`. Onboarding
completion keys on `burner_bios.completed_at` (the burner reached the end and saved),
never on a name. Where someone has no handle, the fallback is a neutral placeholder —
never their legal name, never their email.

**Two privacy classes**, both enforced in `packages/core` and never in the UI:

- **Hard-locked** — phone, both emergency contacts, SA ID, passport. No reveal path
  of any kind. The single exception is an accepted officer registration, which shares
  a phone with the org through an explicit consent flow.
- **Safety-visible — medical notes only.** Never public. Visible to the audience the
  burner disclosed them to: the leads of their **own** camp, and org staff. **The
  consent is the field's own label**, which names that audience at the point of
  entry — exactly how the paper form already works. There is no reveal ceremony,
  because friction in an emergency protects nobody. Notes are encrypted at rest,
  appear only on a member **detail** view (never a list, roster, card or export), and
  every disclosing read writes an audit row.

  **An enumeration detector was built and deliberately removed** (26 Jul 2026), and
  should not be rebuilt: it flagged any account reading 8+ burners' notes in an hour,
  but that is precisely what a safety lead preparing for site does. It reported
  ordinary care as an incident and taught the people we most need reading this
  information that the tool watches them. The trail is a **record**, not monitoring.

**The platform never holds or processes money.** Registration is free — AfrikaBurn
does not charge theme camps. The `payments` table exists only as reference/status
tracking for future logistics apps, and there is no payment UI in any registration
context.

**Fewer forms, not more.** The problem being solved is that people don't fill out
forms. Derive over ask, carry forward by default, progressive disclosure. A feature
that adds mandatory admin carries the burden of proof against itself.

## Org console ranks

Three ranks, all granted (never self-service), all resolved through the single
capability matrix in `packages/core/src/org-permissions.ts` — the gate, every server
action and every piece of UI read the same table, so a hidden button and a refused
action cannot disagree.

| capability                      | engineer | org_staff | System manager (`god`) |
| ------------------------------- | -------- | --------- | ---------------------- |
| `read` — the whole console      | ✅       | ✅        | ✅                     |
| `read_personal_information`     | ❌       | ✅        | ✅                     |
| `write` — reviews, standings    | ✅       | ✅        | ✅                     |
| `delete` — destructive removals | ❌       | ✅        | ✅                     |
| `manage_camp_categories`        | ❌       | ❌        | ✅                     |
| `manage_accounts`               | ❌       | ❌        | ✅                     |
| `read_system` — `/system`       | ✅       | ❌        | ✅                     |

**These are jobs, not a ladder.** `read_system` goes to engineer and not org_staff;
`read_personal_information` and `delete` go the other way. Any check shaped like
`rank >= org_staff` is wrong in both directions — ask `orgCan`.

`god` is the **stored** value and renders everywhere as **"System manager"**; the
inconsistency is deliberate (renaming it would migrate live rows and re-cut the
`GOD_EMAILS` bootstrap for a label). `god` comes only from a verified address on
`GOD_EMAILS`; `engineer` and `org_staff` are granted by a System manager.

`/system` in the org console reports the resolved state of every environment
variable — set or unset, and what follows — plus a live database probe, the migration
verdict from the same function the build calls, what the auth stack is actually
enforcing, and who holds console access. **It never prints a secret.**

## Design

`design/ab-initial-app.pen` is the design source of truth, edited **only** through the
pencil MCP tools. Design comes before build: new features get frames, Ryan reviews,
then code starts.

- [`design/pen-lessons.md`](design/pen-lessons.md) — read before touching the canvas.
  Accumulated law: the dialect, the bridge quirks, the verification protocol, and the
  mobile-360 pairing convention.
- [`design/qa/REVIEW.md`](design/qa/REVIEW.md) — the binding review process. Never
  judge a frame by a full-frame screenshot; tall frames render as unreadable
  thumbnails and visual QA has provably missed severe defects that way.
- `design/brand/` — the approved AfrikaBurn wordmark and San-hand emblem.

Visual system: "Tankwa Night" — dark-first, AfrikaBurn's real brand colours, Montserrat,
and the `QuiltBand` motif across each app header. Full token tables in
[`docs/build-spec.md`](docs/build-spec.md) §7.

## Contributing

We'd love the help, and you do not need to be a backend engineer — most of the
work is front-end, design and wording.

**[Read `CONTRIBUTING.md`](CONTRIBUTING.md)** — how to get it running (it boots
without a database, so there is no `.env` to beg for), where things live, the
commit convention, and the workflow for designers editing the Pencil canvas.

| I want to…                                      | Go here                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Report something broken **while using the app** | The in-app reporter — it files the issue for you (see below)                 |
| Report something broken                         | [Open an issue](../../issues/new/choose) → _Something is broken_             |
| Suggest a design or UX change                   | [Open an issue](../../issues/new/choose) → _Design change_                   |
| Fix wording in the app                          | [Open an issue](../../issues/new/choose) → _Wording fix_                     |
| Propose a feature                               | [Open an issue](../../issues/new/choose) → _Feature or change request_       |
| Report a **security or privacy** problem        | **Privately** — [`SECURITY.md`](SECURITY.md). Never a public issue.          |
| Write some code                                 | [`CONTRIBUTING.md`](CONTRIBUTING.md), then pick up an issue and say so on it |

Two things to know before you start:

- **The app is live**, with real participants' personal information in it. Run it
  locally; never test against the deployment. [`SECURITY.md`](SECURITY.md)
  explains why, and it is the one rule with no exceptions.
- **Nothing in this product may claim something that isn't true** — a disabled
  control says why, a "saved" message means something was saved. It is the most
  common reason a change gets sent back.

### The in-app reporter

Signed-in people can file a bug or feature request from inside any of the three
apps, with recent client errors attached and dictation if they'd rather speak than
type. The server turns it into a **public issue on this repository**, labelled
`needs-triage` — see [`docs/triage.md`](docs/triage.md) for what happens next.

Three things about it are deliberate and worth knowing before you touch it:

- **The issues are authored by the maintainer's GitHub token, from words somebody
  else typed.** Every one of them says so in the body, and carries `source: in-app`.
  That is not decoration — it is the only thing distinguishing a participant's
  report from the account holder's own words.
- **The reporter's identity is never published.** The repository is public and an
  account id is personal data. The pairing of issue number to reporter is in the
  server log alone, which is also how you reach somebody for more detail.
- **Reports are redacted, and redaction fails open.** Emails, phone numbers, ID
  numbers and JSON fragments are stripped before filing
  ([`report-sanitize.ts`](packages/core/src/report-sanitize.ts)); names and free-text
  medical notes cannot be. The real defence is the collection caps in
  [`report.ts`](packages/core/src/report.ts) — collecting little enough that there
  is not much to leak. Never describe a filed report as anonymised.

It needs no configuration to build or run. Unset `GITHUB_TOKEN` and the endpoint
returns a 503 that says so; unset `ANTHROPIC_API_KEY` and reports file from a plain
template; unset `GROQ_API_KEY` and dictation is unavailable. Setup is in
[`docs/deploy.md`](docs/deploy.md) §4a, and `pnpm labels:sync` creates the labels.

Licensed **FSL-1.1-ALv2** (see [`LICENSE`](LICENSE)): source-available, converting
to Apache 2.0 two years after each release. Contributions come in under those same
terms — there is no CLA to sign.

## Documents

`docs/build-spec.md` wins for engineering; `AGENTS.md` wins for process.

| Doc                                                                        | What it holds                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`docs/build-spec.md`](docs/build-spec.md)                                 | The engineering contract: schema, routes, org ranks, the System panel, seed law              |
| [`docs/deploy.md`](docs/deploy.md)                                         | First-deployment runbook — Neon, Vercel × 3, env vars, the live smoke test                   |
| [`docs/triage.md`](docs/triage.md)                                         | The issue queue: the label taxonomy, the triage routine, and handling in-app reports         |
| [`docs/accounts-security-spec.md`](docs/accounts-security-spec.md)         | Auth, account management, the medical-notes consent model, ID retention                      |
| [`docs/auth-platform-spec.md`](docs/auth-platform-spec.md)                 | The self-hosted Better Auth plan of record (executed) — threat model, POPIA, CI              |
| [`docs/questionnaire-spec.md`](docs/questionnaire-spec.md)                 | The questionnaire engine — definitions, activations, audiences, blocking flows               |
| [`docs/notifications-spec.md`](docs/notifications-spec.md)                 | Notifications and bulletins                                                                  |
| [`docs/supplier-spec.md`](docs/supplier-spec.md)                           | Supplier repository, vetting, onboarding                                                     |
| [`docs/component-spec.md`](docs/component-spec.md)                         | The component system, and the page → canvas-frame index                                      |
| [`docs/synthesis.md`](docs/synthesis.md) · [`roadmap.md`](docs/roadmap.md) | Correlated requirements from the source briefs, and the release sequence                     |
| [`docs/technical-spec.md`](docs/technical-spec.md)                         | Section-by-section technical answer to the App Spec — what is built, and what each gap takes |
| [`docs/architecture.md`](docs/architecture.md)                             | System, packages, request path and data model — with diagrams                                |
| [`docs/flows.md`](docs/flows.md)                                           | The user journeys: onboarding, registration + review, questionnaires, suppliers              |
| [`docs/sources/`](docs/sources/)                                           | **Verbatim primary sources — never edit.** See below                                         |

### `docs/sources/` — primary source material

Scraped and extracted ground truth, kept **verbatim**: AfrikaBurn's own published
pages and the source scope documents. Cite it rather than guessing event facts.
Nothing in it is edited to match the product — where it says "burner name" or
describes an older process, that is the source speaking, and it stays.

- [`docs/sources/quaggapedia/`](docs/sources/quaggapedia/INDEX.md) — a full
  point-in-time mirror (22 July 2026) of AfrikaBurn's official event wiki: 68 canonical
  pages and 21 binaries (supplier depot rules, SOOP sound levels, WAP/ticket rules, the
  DMV process, LNT/fire/generator rules, event and sound maps, the STAR onboarding PDF).
  Captured via the wiki's open MediaWiki API — 123 main-namespace pages enumerated,
  language variants and junk filtered out, then fetched in parallel and converted to
  markdown with provenance frontmatter. The wiki will drift; re-run the process to refresh.
- [`docs/sources/afrikaburn-org/`](docs/sources/afrikaburn-org/) — the public site mirror.
- Text extractions of Finlay Kettlewell's Master Brief and five scope documents (the
  **concrete scope**) plus Graham's Quagga Portal platform doc (**ideation topics only**),
  with one example contact redacted.

## Repo notes

- The repo is **public**: no real personal contact data (supplier contacts are scrubbed
  on import), and no naming real businesses in negative demo states.
- History was rewritten once (24 Jul 2026) to purge unredacted originals. The
  `archive/source-documents` branch exists only locally on Ryan's machine — never
  recreate or push it.
- `AfrikaBurn App/` at the repo root is an untracked duplicate of the source folder.
