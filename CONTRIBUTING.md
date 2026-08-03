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

When you *do* want real data locally:

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

## Designers: working on the canvas

`design/ab-initial-app.pen` is the source of truth for how the product looks. It
opens in [Pencil](https://pen.dev), and it lives in git like everything else.

**One person edits it at a time.** This is not a preference, and the reason is
worth knowing: the file is 173,000 lines of JSON describing one deeply nested
node tree. Git *can* merge that line by line — which is the danger, not the
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

The workspace name with the `@quagga/` prefix dropped:

`web` · `org` · `suppliers` · `core` · `db` · `ui` · `auth` · `types` · `e2e`

Plus `repo` for root-level changes (turbo config, workspace tooling, this file).

- **Several workspaces**: comma-separate, most-affected first —
  `fix(web,org): …`. Past three, use the one that owns the change or drop the
  scope.
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

Expect questions about *why*, not just *what*. The comments in this codebase
carry a lot of history — most of them exist because something went wrong once —
and a change that removes a guard will be asked what the guard was for. That is
not suspicion of you; it is how the reasoning survives people leaving.
