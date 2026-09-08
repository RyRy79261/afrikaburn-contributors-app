# Contributing

Thanks for being here. This is the AfrikaBurn Contributors App — three apps
serving burners, AfrikaBurn's organisers, and the suppliers who work with them.
It is volunteer-built and **already live**, with real people's information in it.
That second part shapes most of the rules below.

You do not need to be a backend engineer to contribute. Most of the work is
front-end, design and wording, and none of it needs you to understand the
database.

**Before anything else: the app is live, so never test against it.** Run it
locally. [`SECURITY.md`](SECURITY.md) explains why in more detail, and it is the
one rule with no exceptions.

## Getting set up

You need **Node 22+**, **pnpm**, and **Docker** (only for the end-to-end tests —
skip it if you are doing front-end work).

```bash
pnpm install
pnpm --filter @quagga/web dev          # participant app  → localhost:3000
pnpm --filter @quagga/org dev          # organiser console → localhost:3001
pnpm --filter @quagga/suppliers dev    # supplier portal   → localhost:3002
```

**Everything boots without a database.** There is no `.env` to beg for and no
secret to be handed. Screens that need data render an honest "not configured"
state instead of crashing, which is deliberate — it means a designer or
front-end contributor can run the real app on day one and see real layouts.

When you _do_ want real data locally:

```bash
pnpm e2e:local                    # brings up Postgres, migrates, seeds, runs everything
pnpm e2e:local specs/new-burner   # ...or just one persona
```

That seeds fake camps and fake burners. No real person is ever in it.

## Where things live

```
apps/web           participant app     — what burners see
apps/org           organiser console   — AfrikaBurn staff
apps/suppliers     supplier portal
packages/ui        shared components   — used by all three
packages/core      the domain rules    — permissions, privacy, state machines
packages/db        schema + migrations
design/            the Pencil canvas + brand assets
docs/              the specs. Where a spec and the code disagree, say so in your PR.
```

If you are changing how something **looks**, you are almost certainly in
`apps/*/components/` or `packages/ui/`. If you find yourself in `packages/core`
or `packages/db`, pause — those change behaviour in three apps at once, and they
need a review from the maintainer (see [`.github/CODEOWNERS`](.github/CODEOWNERS)).

## The house rule

**Nothing in this product may claim something that isn't true.**

That sounds abstract; it is extremely concrete in review. A disabled button says
why it is disabled. A page never shows a placeholder that reads like real data.
A "saved" toast appears only after something was actually saved. A security
notice is never sent for a change that did not happen.

It is the single most common reason a change gets sent back, so it is worth
knowing before you write anything. If a control can't do the thing yet, say so on
the screen — the codebase is full of examples.

## Adding a `/v1` endpoint

**None of `/v1` exists yet.** The surface is specified in
[`docs/sdk/delegation/`](docs/sdk/delegation/README.md) and nothing implements it. This
checklist is here before the code because the first endpoint is the one most likely to set
the pattern the rest copy — and because a reviewer needs something to point at. If you are
not building the API, skip to [the house rule](#the-house-rule).

Twelve items. Each is checkable in review, and a reviewer will check them in this
order. If an item does not apply, say "n/a" and why — silence reads as "not done".

**1. Write the DTO before the endpoint.**
The response type comes first, in `packages/types/src/responses/`. It is a closed
`z.object()` parsed with `.parse()` — never `.strict()` (which throws), never
`.passthrough()`, never `z.record()`, `z.any()` or `z.unknown()` anywhere in the tree.
One open-ended node disables stripping for its whole subtree. No field named in
`HARD_LOCKED_PRIVATE_FIELDS` (`packages/core/src/privacy.ts:39-47` — `saId`, `passport`,
`phone`, `onsiteContactName`, `onsiteContactPhone`, `offsiteContactName`,
`offsiteContactPhone`) or `REGISTRATION_CONTACT_KEYS` (`apps/org/lib/queries.ts:952-960`
— seven more human contact columns that sit **outside** the hard-locked set) may appear.
`SAFETY_VISIBLE_FIELDS` (`privacy.ts:57` — `medical`) may appear on exactly one endpoint,
which has its own scope, its own tier and its own audit rule; see item 9.

**2. Declare the scopes, from the closed list.**
One exported `scopes:` array per `route.ts`, drawn from `packages/scopes`. There are
**50** strings in five namespaces — `org:<cap>:<domain>`, `camp:<permission>`, `self:*`,
`bio:*`, `public:*`. You do not invent one to make a feature work; you ask. A scope with
no entry in the `GUARDS` map does not compile — the map is
`{ readonly [S in Scope]: Guard }`, exhaustive by type, not by grep.

**3. Never accept a caller-supplied subject.**
No request body, query parameter or header names a user. The subject arrives as a column
on a row the burner themselves wrote — a relay ticket whose foreign key is their live
`session.id`. A CI scan asserts the identifier `subjectUserId` appears nowhere under
`apps/web/app/api/v1/**`; a rule about the _value_ of a field is weaker than the field
not existing.

**4. Read no cookie — and neither may anything you call.**
Not `cookies()`, not `headers().get("cookie")`, not `getSession`, not
`getCurrentCampUser`, not `requireCampUser`, not `redirect()`. **This is transitive**:
the failure is a store function one call deeper. Every store you call takes an explicit
`userId`. The `Cookie` header is deleted twice — once in `apps/web/middleware.ts` and
again in the `/v1` wrapper — and the CI check is an import-graph walk, not a scan of the
route file.

**5. Resolve the three-way intersection, in order, server-side.**

```
STAGE 1 — the scope gate. Set maths. Can ONLY subtract.
  admissible = ticket.scopes ∩ consent.scopes(live) ∩ integration.ceiling(live)
  ⇒ 403 insufficient_scope

STAGE 2 — the rights gate. The decision. Unchanged @quagga/core predicates over an
  actor loaded LIVE from the DB for the END USER.
  canViewMedicalNotes / hasProjectPermission / orgCanInDomain
  ⇒ 404 not_found (existence-opaque)
```

Nothing is a token claim. Nothing is a cached manifest. There is no sweep job, and there
must never be one — a job's schedule would become the security boundary. Your handler's
only powers are 401 and 403; every 200 still requires a `@quagga/core` predicate to
return `true`.

**6. Load the actor through the shared loaders.**
`loadOrgActor`, `loadCampPermissions` and `loadMedicalAccessContext` live in
`packages/db/src/actor.ts` — singular, as `docs/sdk/04-backend-work-required.md:935` and
`:1422` name it — and are the only sanctioned way to turn a `users.id` into an
actor. Do not paste an app's version. `packages/db` already imports `@quagga/core` and
the reverse is forbidden, which is why the loaders live there.

**7. Refuse without leaking.**
Non-existence, no-permission and not-visible-to-you return **identical bytes**. That is
the API face of `apps/web/lib/groups-store.ts:187`, literally
`if (!registered && !viewerRole) continue;`. A refusal never contains a department name
or an `ORG_DOMAIN_LABELS` value — department names are the org chart. On the wire there
are two 401 buckets and nothing finer: `reconnect_required` (ticket expired, session
ended, consent revoked, renewal window closed — all four have the identical correct
integrator response) and `invalid_credentials` (everything else, byte-identical).
Distinguishing _which_ would tell a thief whether the burner personally revoked.

**8. Rate-limit on three keys.**
`ip`, `integration`, and **`integration:subject`**, all through `consumeRateLimit` against
`action_rate_limit`. Never better-auth's `rate_limit` table — `packages/db/src/schema.ts:453-461`
records that Better Auth sweeps it unfiltered and it cost the password-reset budget once.
The third key exists because under delegation the resource is a _person_, not an app.

**9. If it discloses medical, call the existing resolver — do not write a second one.**
`resolveMedicalNotesForViewer` in `apps/web/lib/medical-access.ts` is the same function
`apps/web/app/(app)/burners/[id]/page.tsx` calls. `/v1` passes one extra `via?` parameter
that flips its `after()` fail-open audit into a blocking fail-closed one. **You do not
reimplement decrypt + the three-state result + the audit write in a route handler.** One
implementation cannot drift from itself, which is why there is no anti-drift test for the
sharpest read in the product.

**10. Audit the disclosure to the human, before the response.**
`audit_events` row: `actor_id` = the **end user's** `users.id`; `action` =
`bio.medical.view`, **unchanged** (a variant string drops out of `getMedicalAccessLog`'s
filter and back _into_ `getAuditTrail` for actors without `personal_information` in
`audit`, creating an unfiltered disclosure census for the one rank that must not have
one); `subject` = whose data; `meta` = ids, enums and `requestId` **only**. On the API
path the insert is `await`ed and precedes the response: no row, no body, 503
`audit_unavailable`. Do **not** add a threshold, a profile, a count or an alert —
`AGENTS.md` is explicit that this is a record, not monitoring, and an enumeration
detector was built and deliberately removed.

**11. Write the invariant test, then break it on purpose.**
`AGENTS.md`: _"After writing a regression test, break the thing on purpose and watch it
go red."_ An endpoint either satisfies the existing suite or adds a named test to it. The
suite runs inside `pnpm turbo run … test`, under the single `CI pass` check.

**12. Run `pnpm sdk:local`.**
The unit gate never starts a route handler. If you have not run it, say so in the PR
rather than letting it be discovered.

## The scope vocabulary

- **It is closed: 50 strings, five namespaces.** `org:<cap>:<domain>`,
  `camp:<permission>`, `self:*`, `bio:*`, `public:*`. You do not add one to make a
  feature work. You ask.
- **`bio:` has exactly one member** — `bio:medical:read` — and it is a separate namespace
  on purpose, so "medical is a higher tier" is structurally enforceable rather than a
  convention in a list. It is disclosing-tier: 120-second single-use tickets, never
  renewable, blocking audit.
- **`org:*` is not delegable.** `isDelegableScope` rejects the prefix. This is not a
  default you can flip; it is a precondition. If it ever changes, the resolver must first
  recompute `orgCanInDomain(loadOrgActor(sponsorUserId), …)` **live on every request**, or
  a demoted sponsor leaves a live ceiling that outlives them. The test that enforces this
  carries that sentence as its failure message.
- **A scope is not a permission.** It names what an integration _may ask for_. Whether the
  end user _has_ it is decided by `@quagga/core`, live, per request.
- **The SDK's copy is generated and committed**, and CI diffs the regenerated output. A
  hand-edit to a generated file passes review and fails the build — which is stated here
  so nobody spends an afternoon on it.
- **Adding, renaming or removing a scope on an existing operation is a breaking change**
  for code you cannot deploy, and it is CODEOWNERS-gated.

## What you may not do

Each of these is the _cheap_ resolution under deadline, which is why it is written down
in advance rather than argued in a review thread.

| Forbidden                                                                                 | Why                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-roll an authz check anywhere near `/v1`                                              | `packages/core/src/org-permissions.ts:22-25` already records what a second source of truth for permissions costs. The scope intersection is _narrowing_, never a second policy.                                                                                                              |
| Publish, re-export or copy `org-permissions.ts`, `project-permissions.ts` or `privacy.ts` | Settled. Enforced by a source/manifest check **and** a tarball check — two on purpose, because a bundler can inline through a devDependency the first one permits.                                                                                                                           |
| Add a permission table, a role table, or a second rights vocabulary                       | Org roles v1 (migration 0018) exists precisely to remove the second vocabulary.                                                                                                                                                                                                              |
| Edit, regenerate or "fix" an existing migration                                           | `AGENTS.md` rules 1-2. Latest is 0028; append-only; applied at deploy against production; there is no staging.                                                                                                                                                                               |
| Accept a `subjectUserId` — or any caller-supplied subject — in a request                  | The impersonation primitive this whole design exists to make inexpressible.                                                                                                                                                                                                                  |
| Add `.passthrough()`, `z.record()` or an allowlist entry to a response schema             | The predicted cheap resolution when a field is missing. Add the field to the DTO instead.                                                                                                                                                                                                    |
| Add volume thresholds, per-actor profiling or alerting on medical reads                   | A detector was built and removed on purpose.                                                                                                                                                                                                                                                 |
| Put a name, an email, a count, a rate or a risk score in `audit_events.meta`              | The POPIA scrubber is a literal three-key subtraction — `SET meta = meta - 'email' - 'contactEmail' - 'primaryEmail'` (`apps/web/lib/account-sanitize.ts:351`); anything else you add is permanent and un-scrubbed. Ids resolve to names at read time through tables erasure _does_ control. |
| Make the API's medical audit non-blocking to "match" the first-party path                 | The first-party fail-open is justified by a medic at a screen. It does not transfer to an HTTP round trip retryable in 40ms, and the record is the entire basis on which disclosure to a non-member is permitted.                                                                            |
| Mint an integration or a key from a grantable capability                                  | Rank only (`requireSystemManager`). The right to edit rights must not be grantable.                                                                                                                                                                                                          |
| Weaken a guard to make a test pass, or lower a coverage floor to make a build pass        | Already `SECURITY.md`; restated here because the API's guards are new and therefore look arbitrary.                                                                                                                                                                                          |

## Designers: working on the canvas

`design/ab-initial-app.pen` is the source of truth for how the product looks. It
opens in [Pencil](https://pen.dev), and it lives in git like everything else.

**One person edits it at a time.** This is not a preference, and the reason is
worth knowing: the file is 173,000 lines of JSON describing one deeply nested
node tree. Git _can_ merge that line by line — which is the danger, not the
safeguard. Two designers' edits merged line-wise produce structurally valid JSON
that is semantically wrong: duplicated node ids, a frame holding children from
two different versions, one edit's geometry against the other's content. Pencil
opens it and shows something subtly broken, which is far worse than a file that
refuses to open, because nobody notices until it has been designed on top of.

`.gitattributes` marks `*.pen` as `-merge`, so git stops and says "both
modified" rather than doing it. Somebody then picks a side, reopens it in Pencil
and redoes the losing change by hand. That is the best outcome available, which
is why the coordination below matters more than it looks.

So, in practice:

1. Say in the channel that you're taking the canvas.
2. `git pull` **first**, always.
3. Make your changes in Pencil.
4. Commit and push **as soon as you stop**, even if the work isn't finished —
   a pushed half-change costs nothing; an unpushed one blocks everyone.
5. Say you're done.

If you want to propose something without touching the canvas, open a
**Design change** issue instead — that path exists precisely so you don't have to
take the file.

Keep `design/pen-lessons.md` up to date when you learn something about the
format the hard way. Several people have already paid for those lessons.

## Working on an issue

Say so on the issue before you start, so two people don't build the same thing.
Small PRs get reviewed quickly; large ones sit. If a change is getting big, open
it early as a draft and ask.

**Read the labels before you pick something up** — the full taxonomy and the
triage routine are in [`docs/triage.md`](docs/triage.md), but two of them change
how you should read an issue:

- **`needs-triage`** means nobody has looked at it yet. The `type:` may be wrong
  and there is no agreed priority. Not a great first pick unless you're triaging.
- **`source: in-app`** means it was filed by the in-app reporter — the words are a
  user's, published under the maintainer's GitHub account, and unverified. Expect
  to reproduce it before believing the diagnosis, and expect not to be able to
  reply to the reporter (the issue deliberately carries no account identity).

If an issue contains personal information that should not be public, **say so
privately** ([`SECURITY.md`](SECURITY.md)) rather than commenting on it. Editing
it out is not enough — GitHub keeps the edit history.

## Commit and pull-request titles

[Conventional Commits](https://www.conventionalcommits.org/) with a **workspace
scope**, which is the standard for a pnpm/turbo monorepo:

```
type(scope): imperative subject
```

- **lowercase**, **imperative** ("add", not "adds" or "added"), **no full stop**
- **≤ 72 characters** — GitHub truncates the rest in list views, and a title that
  only makes sense when expanded is a title nobody reads
- `!` before the colon marks a breaking change, with a `BREAKING CHANGE:` footer

### Types

| type       | for                                                          |
| ---------- | ------------------------------------------------------------ |
| `feat`     | a capability that did not exist                              |
| `fix`      | behaviour that was wrong                                     |
| `perf`     | same behaviour, measurably faster                            |
| `refactor` | same behaviour, different shape                              |
| `test`     | tests only — including making a test actually test something |
| `docs`     | documentation and comments only                              |
| `build`    | build, bundling, dependencies                                |
| `ci`       | GitHub Actions, the e2e runner script                        |
| `chore`    | repo plumbing that is none of the above                      |
| `revert`   | reverting a previous commit                                  |

### Scopes

Three kinds, and the difference matters:

- **workspace names with their npm scope dropped** — `@quagga/*` and `@afrikaburn/*`:

  `web` · `org` · `suppliers` · `core` · `db` · `ui` · `auth` · `types` · `scopes` ·
  `sdk` · `react` · `e2e`

  (`sdk` and `react` are `@afrikaburn/*`. The directory is `packages/sdk-react`; the
  scope is `react`, matching the **package** name, because that is what a reader
  recognises in a changelog.)

- **`api`** — the `/v1` HTTP surface. It lives inside `apps/web` rather than in a
  workspace of its own, and it gets a scope anyway: without one, every server-side commit
  in the workstream is scoped `web` or `core` and the whole thing is invisible in
  `git log --oneline`.

- **`repo`** — root-level changes (turbo config, workspace tooling, this file).

- **Several workspaces**: comma-separate, most-affected first — `fix(web,org): …`. Past
  three, use the one that owns the change or drop the scope.
- **Repo-wide**: omit the scope entirely, or use `repo`.

### Examples from this repository

```
fix(web): exclude sanitized accounts from the anti-lockout counts
feat(org): assign a wrangler to an approved camp
fix(db): scope officer consent to one edition
test(e2e): drive the section-reply loop instead of skipping it
ci: give the god-sharing shards one worker
chore(repo): stop turbo archiving the dev server into its cache
```

### What a title is for

The subject line is the only part most people ever read, in `git log --oneline`
and in the PR list. Make it say **what changed**, not what area you were in:
`fix(web): the deletion guard counted deleted accounts` is useful;
`fix(web): deletion fixes` is not.

Prose headlines — `deletion didn't know about the rest of the product` — read
well in a changelog and sort, filter and tool badly. Put that sentence in the PR
body's summary, where it earns its place.

### Enforcement

Both halves are checked, because this repo **merges** pull requests rather than
squashing them — every individual commit lands on `main`, so the PR title is not
the only thing anyone reads.

| where                                               | what                                       | escape hatch             |
| --------------------------------------------------- | ------------------------------------------ | ------------------------ |
| `.husky/commit-msg`                                 | your commit message, as you write it       | `git commit --no-verify` |
| `.github/workflows/ci.yml` → **commit conventions** | the PR title, and every commit the PR adds | none                     |

The hook comes from `pnpm install` (via the `prepare` script). CI checks the
range from the merge base, so history already on `main` is out of scope — this
binds new commits without demanding the old ones be rewritten.

Rules live in `commitlint.config.mjs`. It extends `@commitlint/config-conventional`
and changes three things: the scope list is the enum above (an unlisted scope
fails — `fix(accounts):` looks reasonable and names nothing that exists), the
header limit is 72 rather than 100, and long body/footer lines warn instead of
failing, because hard-wrapping a URL to satisfy a linter makes a message worse.

Merge commits and git-generated reverts are ignored; they cannot be conventional
and are not written by a person.

## Pull request descriptions

`.github/pull_request_template.md` is applied automatically. Two sections in it
are load-bearing rather than ceremonial, because of what this product is:

- **Database** — the product is **deployed**. Every migration runs against
  production data on the next deploy. State the migration number, whether it is
  additive, and exactly what any backfill touches. "None" is a fine answer and
  should be said out loud.
- **Risk** — what breaks if this is wrong and how anyone would notice.

Keep the body's _Summary_ in plain prose. The convention is about the title and
the structure; it is not an instruction to write like a machine.

## Before you push

```
pnpm -w exec turbo run lint typecheck test build
```

and the e2e shard your change touches:

```
E2E_SERVE=build E2E_PROJECTS=desktop-chromium ./scripts/e2e-local.sh specs/<persona>
```

`scripts/e2e-local.sh` frees ports 3000-3002 first and refuses to run if it
cannot — a leftover server from an interrupted run will otherwise be silently
tested instead of your build.

**If you are doing front-end or design work**, the first command is the one that
matters. The e2e suite needs Docker and takes about ten minutes; run it if you
touched sign-in, sessions, permissions, or anything a person's privacy depends
on. Otherwise CI will run it for you on the pull request, on every shard, for
free — and unlike most projects, **it runs on forks too**, because none of it
needs a secret.

### Two traps that have cost real time

- **A long-lived `next dev` keeps a stale module graph.** Delete a file something
  imports and the running server serves 500s while the build stays green. If you
  have deleted or moved anything, restart dev.
- **Local Postgres is not Neon.** Green locally is strong evidence, never proof.

## Review

The maintainer reviews everything. Changes under
[`.github/CODEOWNERS`](.github/CODEOWNERS) — migrations, auth, `packages/core`,
CI — need their approval specifically, because those are the places where a
mistake is expensive or cannot be undone. Migrations in particular run against
the live database on the next deploy.

Expect questions about _why_, not just _what_. The comments in this codebase
carry a lot of history — most of them exist because something went wrong once —
and a change that removes a guard will be asked what the guard was for. That is
not suspicion of you; it is how the reasoning survives people leaving.
