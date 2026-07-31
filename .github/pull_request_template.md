<!--
TITLE: Conventional Commits with a workspace scope — see CONTRIBUTING.md.
    type(scope): imperative subject, lowercase, no full stop, <=72 chars
    e.g. fix(web): exclude sanitized accounts from the anti-lockout counts
Scopes are workspace names without the @quagga/ prefix: web · org · suppliers ·
core · db · ui · auth · types · e2e · repo. Several: fix(web,org): … · none: repo.
Add ! before the colon for a breaking change: feat(db)!: …
-->

## Summary

<!-- What changed and why, in 2-3 sentences. Lead with the user-visible effect,
     not the implementation. If this fixes something, say what was broken. -->

## Changes

<!-- Grouped by workspace. One line each; link file paths where useful. -->

- **web** —
- **org** —
- **core** —

## Database

<!-- THIS PRODUCT IS DEPLOYED. Migrations run against production data on the next
     deploy, so this section is not boilerplate.
     - No migration → say "none".
     - New migration → give its number, say whether it is additive, and say
       exactly what any backfill or UPDATE touches.
     - Destructive or irreversible → say so here, in the first line. -->

None.

## Testing

<!-- What you actually ran, and what it proved. "Gate 29/29" alone is not enough
     if the change is behavioural — name the spec or the query you exercised.
     If you verified against real data, say which and whether you rolled it back. -->

- [ ] `pnpm -w exec turbo run lint typecheck test build`
- [ ] Affected e2e shard(s):

## Risk

<!-- What breaks if this is wrong, and how someone would notice. Say "low, no
     behaviour change" when that is true. Call out anything reachable by users
     before it is reviewed. -->

## Notes for the reviewer

<!-- Anything you could not verify, deliberately left out of scope, or want a
     second opinion on. Say it here rather than leaving it to be discovered. -->
