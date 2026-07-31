# Contributing

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
