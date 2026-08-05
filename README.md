<div align="center">

# AfrikaBurn Contributors App

**_Quagga Portal_** — one place where a burner has an account, a camp has a
profile, a camp registers for an edition, and AfrikaBurn staff review what comes
in. It replaces a patchwork of Google Forms, WhatsApp threads and spreadsheets.

[![CI](https://github.com/RyRy79261/afrikaburn-contributors-app/actions/workflows/ci.yml/badge.svg)](https://github.com/RyRy79261/afrikaburn-contributors-app/actions/workflows/ci.yml)
[![Licence: FSL-1.1-ALv2](https://img.shields.io/badge/licence-FSL--1.1--ALv2-2D7696)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Postgres](https://img.shields.io/badge/Neon-Postgres-00E599?logo=postgresql&logoColor=white)](https://neon.tech)
[![last commit](https://img.shields.io/github/last-commit/RyRy79261/afrikaburn-contributors-app?color=F4B672)](https://github.com/RyRy79261/afrikaburn-contributors-app/commits)

</div>

---

## Three apps, one account

Sign in once; the same identity works across all three.

<table>
<tr>
<td width="33%" valign="top">

### 🏕️ Participant

**[app.quagga.ryanjnoble.dev](https://app.quagga.ryanjnoble.dev)**

For burners. Your profile, your camp, invites, and the six-section registration
that gets a camp placed.

`apps/web` · port 3000 · teal

</td>
<td width="33%" valign="top">

### 🎛️ Organiser console

**[org.quagga.ryanjnoble.dev](https://org.quagga.ryanjnoble.dev)**

For AfrikaBurn staff. The review queue, questionnaires, bulletins, suppliers,
the audit trail and the system panel.

`apps/org` · port 3001 · apricot

</td>
<td width="33%" valign="top">

### 📦 Supplier portal

**[suppliers.quagga.ryanjnoble.dev](https://suppliers.quagga.ryanjnoble.dev)**

For the companies camps hire. Sign-up, onboarding steps, documents, and
standing.

`apps/suppliers` · port 3002 · sage

</td>
</tr>
</table>

> ⚠️ **The deployment is live**, with real participants' phone numbers,
> emergency contacts and medical notes in it. Run it locally; never test against
> those URLs. [`SECURITY.md`](SECURITY.md) explains why — it is the one rule with
> no exceptions.

## Quick start

Needs **Node ≥ 22**, **pnpm 10**, and **Docker** for the local database.

```bash
pnpm install

# Postgres 16 + the two Neon proxies the drivers need (HTTP and WebSocket)
docker compose -f docker-compose.local.yml up -d

# Migrate, then seed reference data (no accounts — see below)
pnpm --filter @quagga/db db:migrate:deploy
pnpm --filter @quagga/db db:seed

# All three apps, or one: pnpm dev --filter @quagga/web
pnpm dev
```

```bash
# .env — copy from .env.example
DATABASE_URL=postgres://postgres:postgres@localhost:5432/quagga
DATABASE_URL_UNPOOLED=postgres://postgres:postgres@localhost:5432/quagga
NEON_LOCAL_PROXY=1
```

Three things that will otherwise stop you:

- **All three apps boot with no env at all**, to a graceful "not configured"
  state. That is a rule, not a convenience.
- **There are no seeded accounts, in any environment.** Sign up through the app
  like a real person. An empty directory on a fresh database is correct.
- **Reaching the org console locally takes one extra step.** `god` is granted
  only to a _verified_ `GOD_EMAILS` address, and nothing verifies email locally
  — flip the flag by hand, recipe in [`e2e/README.md`](e2e/README.md).

### The two gates

```bash
pnpm turbo run lint typecheck test build   # the fast gate — never runs a browser
pnpm e2e:local                             # the other gate — 8 personas, from cold
pnpm e2e:local specs/new-burner            # ...or just one
pnpm test:coverage                         # coverage floors — all 8 workspaces
```

## Stack

| Layer        | What we use                                                              |
| ------------ | ------------------------------------------------------------------------ |
| **Apps**     | Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui             |
| **Data**     | Neon Postgres · Drizzle ORM · append-only SQL migrations                 |
| **Auth**     | Self-hosted Better Auth 1.6.25 — password, Google, TOTP 2FA, passkeys    |
| **Tooling**  | Turborepo · pnpm workspaces · TypeScript strict · Zod at every boundary  |
| **Testing**  | Vitest (unit) · Playwright (8 persona suites) · v8 coverage floors       |
| **Services** | Resend (email) · Vercel Blob (uploads) · GitHub Issues (in-app reporter) |

Shared packages under `@quagga/`:

```
packages/core     domain logic + every authz predicate — the security boundary
packages/db       Drizzle schema, migrations, and the deploy migrator
packages/auth     Better Auth config, mounted by all three apps
packages/ui       shadcn components and the Tailwind token layer
packages/types    Zod schemas and shared types
```

**`@quagga/core` never imports `@quagga/db`.** The rules stay pure and testable;
apps ask the predicate, never re-implement it. A hidden button and a refused
action cannot disagree.

## Repo at a glance

|                                          |                                   |                                       |                             |
| ---------------------------------------- | --------------------------------- | ------------------------------------- | --------------------------- |
| **107k** lines of TS/TSX · **46k** tests | **44** tables · **29** migrations | **72** routes across 3 apps           | **51** shared UI components |
| **2,733** unit tests                     | **165** e2e tests · 8 personas    | **8** workspaces with coverage floors | **116** design frames       |

Started 22 July 2026. Public repo, so: no real personal contact data, and no
naming real businesses in negative demo states.

## How it fits together

```mermaid
flowchart LR
    subgraph apps["Three apps · one account"]
        web["🏕️ apps/web"]
        org["🎛️ apps/org"]
        sup["📦 apps/suppliers"]
    end
    core["@quagga/core<br/>the rules"]
    db[("Neon<br/>Postgres")]
    web & org & sup --> core --> db
```

Fuller diagrams — system, package graph, request path, data model — are in
[`docs/architecture.md`](docs/architecture.md). The journeys are in
[`docs/flows.md`](docs/flows.md).

## Contributing

You do not need to be a backend engineer — most of the work is front-end, design
and wording. **Start with [`CONTRIBUTING.md`](CONTRIBUTING.md).**

| I want to…                                      | Go here                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Report something broken **while using the app** | The in-app reporter — the button in the bottom-left corner files it for you  |
| Report something broken                         | [Open an issue](../../issues/new/choose) → _Something is broken_             |
| Suggest a design or UX change                   | [Open an issue](../../issues/new/choose) → _Design change_                   |
| Fix wording in the app                          | [Open an issue](../../issues/new/choose) → _Wording fix_                     |
| Propose a feature                               | [Open an issue](../../issues/new/choose) → _Feature or change request_       |
| Report a **security or privacy** problem        | **Privately** — [`SECURITY.md`](SECURITY.md). Never a public issue.          |
| Write some code                                 | [`CONTRIBUTING.md`](CONTRIBUTING.md), then pick up an issue and say so on it |

Two rules that catch people out:

- **Nothing may claim something that isn't true.** A disabled control says why;
  a "saved" message means something was saved. It is the most common reason a
  change gets sent back.
- **Personal data has classes**, enforced in `@quagga/core` and never in the UI.
  Some fields can never be public; medical notes are visible only to that
  burner's own camp leads and safety staff, and every read is audited. See
  [`AGENTS.md`](AGENTS.md) §Privacy classes.

> **Read [`AGENTS.md`](AGENTS.md) before changing anything.** This README is
> orientation; AGENTS.md is law, [`docs/build-spec.md`](docs/build-spec.md) wins
> for engineering, and the **App Specification** (below) sits above all of it —
> see [`docs/README.md`](docs/README.md) for the full precedence chain.

## Documentation

The product's source of truth is the **App Specification** — an external,
Requirement-ID-tagged document (Superhuman, mirrored to a Coda change record).
**[`docs/README.md`](docs/README.md#direction-of-information-travel) carries
the link** and is also the full index and rulebook for everything under
`docs/`: every doc's category and Requirement-ID coverage, the language/status
conventions every doc follows, and the protocol for updating this repo's docs
when the App Spec changes. Start there.

[`docs/sources/`](docs/sources/) holds **verbatim primary sources — never
edit**: AfrikaBurn's own published pages and the original scope documents.

**Design** lives in `design/ab-initial-app.pen`, edited only through the Pencil
MCP tools. Read [`design/pen-lessons.md`](design/pen-lessons.md) before touching
the canvas and [`design/qa/REVIEW.md`](design/qa/REVIEW.md) before reviewing a
frame.

## Licence

**[FSL-1.1-ALv2](LICENSE)** — Functional Source License, converting to Apache 2.0
two years after each release. Use it, read it, build on it; don't ship a
competing product from it in the meantime. Contributions come in under the same
terms, and there is no CLA to sign.
