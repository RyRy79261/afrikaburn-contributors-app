# Security

This repository is public. **The application it builds is live**, with real
AfrikaBurn participants, real camps, and real personal information in it —
including phone numbers, emergency contacts, medical notes and identity
documents. Please read this before you go looking for anything.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting** — the _Security_ tab →
_Report a vulnerability_. It opens a private thread visible only to the
maintainers.

Do not open a public issue for a security problem. Do not post it in a pull
request, a discussion, or a channel. If private reporting is unavailable for any
reason, contact the repository owner directly and say only that you have a
security issue to report; wait for a private channel before sending details.

Please include, as far as you can:

- what an attacker could do, in one sentence
- the steps to reproduce it
- which app it affects (participant / organiser console / supplier portal)
- whether you believe it has been exploited

You will get an acknowledgement. This is a volunteer project, so the honest
expectation is days rather than hours — but a report that lands is a report that
gets read.

## Please do not test against the live deployment

This is the part that matters most, and it is not a formality.

Everything you can reach at the deployed URLs is **production**. There is no
staging environment. The accounts are real people, the camps are real camps, and
a "harmless" probe against them is a probe against a burner's emergency contact
details.

So: **run it locally.** The whole stack comes up on your machine with one
command, seeded with fake data and no real people in it:

```bash
pnpm e2e:local           # Postgres + all three apps + the persona suite
```

Find it locally, report it privately, and we will fix it. Never:

- create accounts, camps or registrations on the live deployment to test a theory
- attempt to access another person's data there, even to demonstrate that you can
- run automated scanners, fuzzers or load tests against it
- act on anything you find in production beyond the minimum needed to confirm it

If you stumble into someone else's data by accident, stop, do not save it, and
report it. That is not a failure — it is exactly the kind of thing worth knowing.

## What we consider in scope

Anything that lets someone:

- read personal information they should not — particularly the hard-locked
  private fields (medical notes, ID documents, emergency contacts) and the
  officer phone numbers that are only disclosed after consent
- act as another account, or escalate their own permissions
- reach the organiser console or the supplier portal without the right role
- send to an audience they should not (a bulletin resolving to the wrong people
  is a privacy incident here, not a UI bug)
- bypass the account-deletion guards, or the anti-lockout rule that keeps at
  least one System manager on the deployment

Out of scope: missing security headers with no demonstrated impact, rate-limit
tuning opinions, findings that require an already-compromised device, and
anything only reachable by an organiser who legitimately holds the permission.

## For contributors

A few rules that exist because of specific things that have gone wrong, here or
elsewhere:

- **Never commit a secret.** `DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `RESEND_API_KEY`, blob tokens. If you commit one, say so immediately — rotating
  it is quick, and quietly force-pushing over it does not remove it from the
  history other people already fetched.
- **`better-auth` is pinned to an exact version and is never auto-bumped.** It
  has a track record of high-severity advisories, and we own the patch watch
  deliberately rather than letting a bot decide. Upgrading it is a considered
  change with the auth e2e suite run, not a dependency PR.
- **Do not weaken a guard to make a test pass.** If a check is in your way, it is
  probably load-bearing; ask. Several of the guards in this repo exist because a
  specific hole was found in review, and the comment above them says which.
- **Privacy is enforced in `@quagga/core`, not in the UI.** Hiding a control is
  never the boundary. If you are adding a surface that shows personal
  information, the server-side check is the thing that matters — see
  `packages/core/src/privacy.ts` and `medical-access.ts`.

## Repository settings

Not code, so not something a pull request can set. For a maintainer, in
_Settings_:

- **Branch protection on `main`** — require a pull request, require review from code
  owners so `CODEOWNERS` has effect, and require **exactly one status check**:

  ```text
  CI pass
  ```

  That is the aggregate gate at the bottom of `.github/workflows/ci.yml`. It needs
  every other job — the build gate, the commit-convention check and all eight e2e
  shards — and fails if any of them did. Require _that_ rather than the individual
  checks: the shard list changes as personas are added, and a shard nobody
  remembered to mark required is one that can go red without blocking a merge.
  Adding a shard needs no change here.

  Leave the three `Vercel – …` checks **unrequired**. They are external statuses,
  not jobs, so the gate cannot cover them — and they fail for reasons that have
  nothing to do with the code (see `docs/deploy.md` on Neon branch quota).

- **Private vulnerability reporting** — _Settings → Security_ → enable. This is
  what the top of this file tells people to use.
- **Secret scanning + push protection** — free on public repositories. Push
  protection is the one that matters: it blocks the commit rather than telling
  you afterwards.
- **Dependabot alerts** — yes to alerts. Be deliberate about auto-merge, and
  exclude `better-auth` from it entirely for the reason above.
