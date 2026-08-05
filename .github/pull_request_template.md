<!--
TITLE: Conventional Commits with a workspace scope — see CONTRIBUTING.md.
    type(scope): imperative subject, lowercase, no full stop, <=72 chars
    e.g. fix(web): exclude sanitized accounts from the anti-lockout counts
Scopes are workspace names without the @quagga/ prefix: web · org · suppliers ·
core · db · ui · auth · types · e2e · repo. Several: fix(web,org): … · none: repo.
Add ! before the colon for a breaking change: feat(db)!: …

KEEP THIS SHORT. Every section below wants a few lines, not paragraphs. If
something needs the long version, put it under "Supplementary context" at the
bottom — that is what it is for. A reviewer who has to read an essay to find the
migration is a reviewer who misses the migration.
-->

## Overview

<!-- 2-3 sentences. The user-visible effect, not the implementation. If this
     fixes something, say what was broken. -->

## What it touches

<!-- One line per workspace you changed; delete the rest. Link file paths where
     it saves a search.
     web · org · suppliers · core · db · ui · auth · types · e2e · repo -->

- **** —

## Testing

<!-- What you ran, and what it proved. The gate alone is not enough for a
     behavioural change — name the spec or the query you exercised. If you
     checked against real data, say which, and whether you rolled it back. -->

- [ ] `pnpm -w exec turbo run lint typecheck test build`
- [ ] Affected e2e shard(s):

## Database

<!-- THIS PRODUCT IS DEPLOYED. Migrations run against production data on the
     next deploy, so this is not boilerplate.
     - No migration → "None." is a real answer. Say it.
     - New migration → its number, whether it is additive, and exactly what any
       backfill or UPDATE touches.
     - Destructive or irreversible → say so in the first line. -->

None.

## Risk

<!-- What breaks if this is wrong, and how someone would notice. "Low, no
     behaviour change" when that is true. Flag anything users reach before it
     is reviewed. -->

## Expected follow-ups

<!-- What this deliberately leaves for later, and anything that has to land with
     it or shortly after — a migration to run, `pnpm labels:sync`, a doc that
     goes stale, a spec to update. "None." if it stands alone. -->

None.

## Notes for the reviewer

<!-- What you could not verify, what you left out of scope on purpose, where you
     want a second opinion. Say it rather than let it be discovered. -->

<details>
<summary>Supplementary context</summary>

<!-- Optional, and the only section with no length limit: the reasoning, the
     approaches you rejected, the long quote from the spec. Collapsed, so it
     costs a reviewer nothing until they want it. Delete the block if unused. -->

</details>
