# Execution Roadmap

> The plan for how we fan out and build the entire AfrikaBurn Contributors App ("Quagga Portal"), broken into the smallest independently-actionable tasks, in dependency order, with an explicit parallel fan-out plan.
>
> Author's note on sizing: **all sizes are estimates.** XS ≈ hours · S ≈ ≤1 day · M ≈ days · L ≈ 1–2 weeks · XL ≈ multi-week / its own app. State labels (`done` / `partial` / `absent`) are carried faithfully from the four source inventories — where an inventory said *partial*, this roadmap says *partial*. Nothing here is marked complete that has not been observed complete.

---

## 0. Reality check

> ### ⚠️ THIS SECTION IS A DATED SNAPSHOT — corrected 27 Jul 2026
>
> Everything below the correction was written on **26 July 2026** and is preserved
> because the reasoning it drove is still legible. **Its central claims are no longer
> true**, and the milestone tables further down still carry `done`/`partial`/`absent`
> labels frozen at that date. Treat this whole document as a **planning artifact and
> historical record**, not as a status board. For what is actually true now, read
> `README.md`, `docs/build-spec.md` and `docs/deploy.md`.
>
> **Corrections, as of 27 Jul 2026:**
>
> | The snapshot said | What is true now |
> | --- | --- |
> | 13 migrations, 0000–0012 | **18 migrations, 0000–0017.** They apply automatically at deploy via the advisory-locked runner, which also bootstraps reference data into an empty database. |
> | No Neon database; migrations never applied; `seed.ts` never executed | A database exists and has been migrated and seeded. There is also a **full local stack** (`docker-compose.local.yml`) that anyone can run off a laptop. |
> | *No page has ever been rendered against real data* | Pages have been driven in a real browser against a real database, repeatedly. |
> | Correctness rests on the unit gate alone | There is a **second gate**: `pnpm e2e:local` — 137 Playwright tests over 8 personas against the real stack. It is not run by `turbo run test`, so it must be run deliberately. |
> | Zero `error.tsx` / `loading.tsx` / `not-found.tsx` boundaries | 34 `loading.tsx`, 7 `error.tsx`, 4 `not-found.tsx` across the three apps (counted 27 Jul 2026). |
> | Zero database transactions in any server action | Transactions landed across all three apps. |
> | Managed Neon Auth blocks 2FA / passkeys / backup codes / email-change / unlink | **All of them shipped.** Auth is self-hosted Better Auth 1.6.25 (`packages/auth`); the plugin tables are migration 0015. M2 was executed. |
> | `apps/suppliers` has no Vercel deployment | Still true at the time of writing — confirm before relying on it. |
>
> The **seeding principle** below is unchanged and still binding. So is the reasoning
> about why the first real DB boot was the largest de-risking act — it was, and it
> surfaced exactly the class of defect predicted.

---

*Everything from here is the 26 Jul 2026 snapshot, as written.*

**What is built.** The product is genuinely code-complete across a large surface: three Next.js 16 apps (web / org / suppliers), Neon Postgres + Drizzle with 13 append-only migrations (0000–0012), `@quagga/core` with ~540 real behavioural unit tests over the pure decision logic (state machines, audience/officer resolvers, privacy hard-locks, questionnaire engine/results, account security, supplier standing). The server actions are **not** UI-only — they carry real DB write paths, Zod boundaries, authz gates and audit-event emission. The design-gap repair commit genuinely landed: the four org tables use a shared `ResponsiveDataTable`, the privilege-change confirm dialog exists, MV/art forms are carded, result bars are responsive. (Spot-verified in code, 26 Jul 2026.)

**What has NEVER happened.** *No page has ever been rendered against real data.* There is **no Neon database** — no `DATABASE_URL`, no `.env` anywhere, the 13 migrations have never been applied, and `seed.ts` has never executed. Correctness today rests entirely on `pnpm turbo run lint typecheck test build` (green, 23/23) plus the core unit tests. Every "done" is **static confidence**: real-data layout/reflow, async & empty transitions, actual query behaviour, migration application, and FK cascade effects are all **unobserved**. `apps/suppliers` additionally has **no Vercel deployment** (web and org do). There are **zero** `error.tsx`/`loading.tsx`/`not-found.tsx` boundaries and **zero** database transactions in any server action.

**The seeding principle (Ryan, 26 Jul 2026 — binding, and it changed this roadmap).** *Seeds contain **only** org-owned reference/catalog data. Every burner, camp, membership, registration and questionnaire response — in every environment, including the kickoff demo — is created **live through the app**.* `seed.ts` was cut from 1637 → 439 lines: it now writes the edition, the org group, the 8 canonical camp categories, the scrubbed supplier catalog (accountless, `user_id` null, claimable by a real supplier later), and one org-authored questionnaire *template*. No users, no camps, no memberships, no registrations, no activations/responses, no notifications, no supplier notes. **This deleted the roadmap's single worst blocker**: seeded camp leads carried placeholder `authUserId = seed:<email>` strings and could *never* sign in, so every "sign in as a seeded owner" step was un-performable and needed a bespoke back-fill task. It also makes the demo **more honest** — it shows the real journey (sign up → register Camp 404 → org reviews it) instead of a pre-baked tableau — and removes an entire class of seed/auth-identity drift. The consequence to internalise: **an empty directory, an empty registrations queue and an empty status board are the correct first-boot state.**

**What this means for the 28 Jul kickoff.** The single largest de-risking act in the whole project is the **first real DB boot** — it will likely surface data-shape/query defects across many surfaces at once. Until M0 is true, nothing else is trustworthy, and no demo is safe. The kickoff narrative must run on a real database with a browser smoke pass behind it, not on the strength of green CI. Treat every runtime-only finding below as **high-probability, not proven**, until M0/M1 close. And because nothing is seeded, the first-boot smoke pass is **the demo script itself** — it creates the data it verifies.

**Two meta-blockers cascade through everything:**
1. **No Neon DB / first deployment (#63)** blocks Blob uploads, Camp 404 integration, and runtime confirmation of *every* static-only audit finding.
2. **Managed Neon Auth's no-custom-plugins constraint** structurally blocks 2FA / passkeys / backup codes and the server-side email-change / unlink commits. It is unblocked only by Neon shipping MFA (their "coming soon") *or* by migrating to self-hosted Better Auth (M2) — which is also the gateway to the parked IdP (M5).

---

## 1. Milestone spine (dependency order)

| Milestone | Goal (one line) | Gate to next |
|---|---|---|
| **M0 GET IT RUNNING** | A real Neon DB, all three apps deployed with env, migrations + the *reference* seed applied, the demo data created **live through the app**, and a human has clicked through every app. | Every app loads real rows in a browser without a 500 — rows a human created through the UI, not seeded ones. |
| **M1 DEMO-READY** | The kickoff narrative works end-to-end and is hardened against first-contact-with-real-data failure. | The demo script runs start-to-finish on prod data; no unhandled render error path. |
| **M2 AUTH PLATFORM** | Self-hosted Better Auth per `docs/auth-platform-spec.md` (Phase 0), done greenfield while zero user data exists. | Sign-up / sign-in / reset / 2FA / passkey work on the apex domain across all three apps. |
| **M3 CORRECTNESS + QUALITY** | Authz & privacy are tested as *wiring* not just predicates; the real CI suite, observability, and a **full E2E suite over every journey including auth** exist. | Dropping a guard or leaking a PII field fails CI; a broken journey fails E2E; auth failures are visible in a dashboard. |
| **M4 FEATURE COMPLETION** | The deferred first-party capabilities ship (wrangler, uploads, grids, edit-resubmit, reply threads, Form-2, …). | The design-gap register's schema/feature majors are closed or explicitly parked. |
| **M5 PLATFORM** | The parked platform bets: IdP, integrations console, Camp 404, MCP/API, logistics apps. | Out of scope for the current push — sequenced only after real adoption. |

**The hard rule that orders the spine:** *M0 before all else.* A green build is not a running app. Do not start M1 feature-hardening against imagined data. **Beyond M0, the spine is a presentation order, not a strict serial chain:** most of M3 (all of it except M3-19 and M3-15's secret-drift alert) is M2-independent and should run in parallel with — or ahead of — the M2 auth swap, so the orphan-write and untested-guard hazards are not left live for weeks (see the note under M3). **The E2E suite (M3-16 … M3-31) should open as soon as M0 closes** — it is the only mechanism that makes "did we break a journey?" answerable without a human clicking through three apps.

---

## M0 — GET IT RUNNING

**Goal:** stand up one real Neon project, wire env on all three apps, apply migrations + the reference seed, then **create the demo data live through the app** and confirm every app renders real rows in a browser.
**Exit criteria:** (a) migrations 0000–0012 applied to a live Neon DB; (b) `seed.ts` run idempotently, no error, reference data only; (c) web, org, suppliers all deployed on Vercel with env; (d) a real burner account exists (signed up through the app) and owns a Camp 404 registration it created through the wizard; (e) a human has loaded the primary page of each app against that live-created data with no 500; (f) `deploy.md` reflects the 3-app reality and the seeding principle.

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M0-01** | Provision one Neon project; capture `DATABASE_URL` (pooled + direct). | XS | Neon console / Vercel env | — | connection string resolves from `psql`/drizzle |
| **M0-02** | Generate `PGCRYPTO_KEY`; store as a secret. | XS | env / secret store | — | key present in all 3 app envs |
| **M0-03** | Set env on **web** Vercel project (`DATABASE_URL`, `PGCRYPTO_KEY`, `GOD_EMAILS`, `BLOB_READ_WRITE_TOKEN`, `NEXT_PUBLIC_APP_URL`). | XS | Vercel (web) | M0-01/02 | web build picks up vars |
| **M0-04** | Set env on **org** Vercel project (same minus Blob). | XS | Vercel (org) | M0-01/02 | org build picks up vars |
| **M0-05** | Create the **suppliers** Vercel project; set its env. | S | Vercel (new project) | M0-01/02 | suppliers deploys to a URL |
| **M0-06** | Add `ACCOUNT_SWEEP_SECRET` + `NEXT_PUBLIC_APP_URL` to `turbo.json` `globalEnv` and `.env.example` (fixes cache-invalidation drift). | XS | `turbo.json`, `.env.example` | — | both keys present; grep confirms |
| **M0-07** | Migrations now apply **automatically on deploy** (`db:migrate:deploy` runs in every app's build, advisory-locked; AGENTS.md rule 1). So this task is: set `DATABASE_URL` + `DATABASE_URL_UNPOOLED` on the Vercel projects, trigger the first deploy, and **watch the `[migrate]` lines in the build log** confirm 0000–0012 applied in one run (and that it used the UNPOOLED connection). No manual `db:migrate` against prod, ever. | S | `packages/db/src/migrate.ts`, `packages/db/migrations/*` | M0-01, M0-03/04/05 | build log shows all migrations applied; all 29 tables exist in Neon |
| **M0-08** | Run `pnpm --filter @quagga/db db:seed`; confirm idempotency by running twice. **Reference data only** — editions, org group, camp categories, supplier catalog + onboarding, one questionnaire template. | S | `packages/db/src/seed.ts` | M0-07 | 6 reference tables populated (`editions`, `groups`(org), `camp_categories`, `suppliers`, `supplier_onboarding`, `questionnaire_definitions`); 2nd run no dupes; **`users`, `memberships`, `registrations` all still empty — that is correct** |
| **M0-09** | Rewrite `docs/deploy.md`: 2-project → 3-app table; correct the stale "payments seeded" line (payments is FREE / unseeded). *(The seeding-principle + live-smoke-path rewrite of `deploy.md` already landed 26 Jul; only the 3-app Vercel table remains.)* | XS | `docs/deploy.md` | — | doc lists 3 apps + ports 3000/3001/3002 |
| **M0-10** | Configure managed Neon Auth env (`NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`) on all 3 apps *(interim — replaced in M2)*. | S | Vercel env × 3 | M0-03/04/05 | not-configured banner disappears |
| **M0-11** | Provision Vercel Blob token for web; confirm registration upload route stops falling back to "paste a URL". | XS | Vercel (web), upload route | M0-03 | an upload persists to Blob |
| **M0-12** | **Create the demo data LIVE through the app** — the replacement for the deleted seeded-account back-fill. Sign up as a real burner on **web** (real inbox, verify the email), complete the Burner Bio, then **register Camp 404 through the actual wizard** (all six sections) and submit. Separately, sign in with a `GOD_EMAILS`-listed verified email so it self-elevates to god on the **org** app. No back-fill, no linking action, no `seed.ts` data edit — the app is the only writer. This *is* the kickoff demo beat, rehearsed. | S | apps/web + apps/org (runtime), auth (M0-10) | M0-07/08, M0-10 | a real burner signs in, owns a Camp 404 registration it created, and that registration appears in the org queue; the god account reaches the org console |
| **M0-13** | Browser smoke test **web**: sign-in, onboarding bio, directory, a camp page, registration wizard. | S | apps/web (runtime) | M0-07/08/10, M0-12 | **verified against the live-created burner + Camp 404**, never a seeded row; primary pages render real rows, no 500; the pre-M0-12 empty states render as empty, not as errors |
| **M0-14** | Browser smoke test **org**: overview, status board, registrations queue+detail, accounts, suppliers. | S | apps/org (runtime) | M0-07/08/10, M0-12 | **queue shows the live-created Camp 404 registration**; suppliers table shows the seeded catalog (the one place seeded rows are expected); reviewing a section writes and notifies |
| **M0-15** | Browser smoke test **suppliers**: self-register (both an email that overlaps a seeded catalog row → claim, and one that doesn't → fresh row), sign-in, onboarding steps, documents. | S | apps/suppliers (runtime) | M0-05/07/08/10 | self-register writes rows; claim-by-email attaches to the seeded catalog row (`user_id` was null by design); onboarding renders |
| **M0-16** | Flip CI `pnpm install --no-frozen-lockfile` → `--frozen-lockfile` (lockfile is committed). | XS | `.github/workflows/ci.yml` | — | CI green with frozen install |
| **M0-17** | Log every runtime defect found in M0-12/13/14/15 into a triage list feeding M1. | XS | tracking doc | M0-12/13/14/15 | defect list exists |

---

## M1 — DEMO-READY

**Goal:** make the kickoff story run end-to-end on real data and survive first contact (empty states, failed reads, thrown queries) without dumping to Next's default error screen.
**Exit criteria:** (a) the demo script runs start-to-finish on prod data; (b) each app has a root `error.tsx` + `not-found.tsx`; (c) the M0 defect list is drained or explicitly deferred; (d) the small honest-surface gaps that read as bugs in a demo are closed.

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M1-01** | Add root `error.tsx` + `not-found.tsx` to **apps/web**. | S | apps/web/app | — | thrown read renders boundary, not stack |
| **M1-02** | Add root `error.tsx` + `not-found.tsx` to **apps/org**. | S | apps/org/app | — | same |
| **M1-03** | Add root `error.tsx` + `not-found.tsx` to **apps/suppliers**. | S | apps/suppliers/app | — | same |
| **M1-04** | Add `loading.tsx` skeletons to the data-heavy dynamic routes (directory, registration, org queue/status). | M | each app's route dirs | — *(independent of M1-01/02/03: `loading.tsx`, `error.tsx` and `not-found.tsx` are separate Next.js route files with no ordering dependency — loading boundaries do not require error boundaries, so this need not serialize behind wave 1a)* | route shows skeleton then data |
| **M1-05** | Surface supplier reference-code chip in portal (#8, M15): add `code` to the suppliers session/onboarding query + render chip. | XS | `apps/suppliers/lib/session.ts`, onboarding page | M0-15 | `SUP-YYYY-NNNN` chip visible |
| **M1-06** | Verify M6: confirm the supplier signup-management page is reachable (live tile + nav entry) on real data; add nav entry if the tile still says "Not built". | S | apps/org console page + nav | M0-14 | page reachable from nav |
| **M1-07** | Runtime-verify the responsive-table + confirm-dialog fixes (already in code) actually reflow/behave at 360px on real rows; file follow-ups only if they don't. | S | apps/org (runtime) | M0-14 | tables usable on mobile viewport |
| **M1-08** | Wire the **existing** `@quagga/ui` `markdown-editor` (already tiptap-based — `@tiptap/*` + `tiptap-markdown` in `packages/ui/package.json` — and already imported on the web bulletin *read* side at `apps/web/app/bulletins/[id]/page.tsx`) into org bulletin **compose** + ensure sanitized render. Only the org compose wiring is missing; the primitive is not "state unknown" and is not being built from scratch (drop the earlier "minimal-tiptap / build if absent" framing). | S | apps/org bulletins/new (consume the existing primitive) | M0-14 | compose renders markdown via the existing editor; output sanitized |
| **M1-09** | **Demo-script rehearsal (replaces the old seed-quality pass — there is no demo content in `seed.ts` to tune any more).** Write the kickoff script as an ordered live sequence (sign up → Burner Bio → create/register Camp 404 → org review → request changes → resolve → approve → bulletin), rehearse it end-to-end on the deployed apps, and time it. Any narrative gap is fixed in **product copy or empty states**, never by seeding rows. **Also confirm the reference seed reads well live**: the 8 category chips and the supplier picker are the only pre-populated surfaces the demo touches. | S | docs (script) + wherever copy/empty-state gaps land | M0-12 | script runs start-to-finish live, no seeded user content anywhere |
| **M1-10** | Drain the M0-17 defect list: fix the data-shape/query defects the first boot surfaced. | M–L | wherever defects landed | M0-17 | defects closed or deferred with reason |
| **M1-11** | Wire the account deletion sweeper: set `ACCOUNT_SWEEP_SECRET`, point an external scheduler at the route (never a build step). | XS | Vercel env + scheduler | M0-06 | route runs authorized, refuses unauthorized |

> **M1 is a hardening milestone, not a feature milestone.** The temptation to start M4 work here is the main scope risk. Anything that isn't "the demo needs it" or "real data broke it" belongs in M4.

---

## M2 — AUTH PLATFORM (self-hosted Better Auth)

**Goal:** execute Phase 0 of `docs/auth-platform-spec.md` — move off managed Neon Auth onto self-hosted Better Auth 1.5.x, **greenfield now** while zero user data exists (zero migration cost). This unblocks 2FA / passkeys / change-email / unlink and the future IdP.
**Exit criteria:** (a) an apex domain owns `app./org./suppliers.` subdomains; (b) sign-up / sign-in / reset / verify work branded on all three apps; (c) `rateLimit.storage` is `'database'`; (d) cross-subdomain SSO holds; (e) the capability matrix is flipped and the probe layer decision recorded.

> **Irreversibility warning:** two decisions here are near-irreversible and must be made *before* generating tables — the identity-vs-profile table boundary (§2.3) and the passkey `rpID` (the shared apex, un-migratable once users enrol). Make both explicitly, in writing, first.

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M2-01** | **Decision:** register the apex domain (the one unavoidable paid line); attach 3 subdomains in Vercel. | M | domain registrar + Vercel | — | 3 subdomains resolve over HTTPS |
| **M2-02** | **Decision (write it down):** identity-vs-profile table boundary (§2.3) + `rpID` = apex. Near-irreversible; gate before M2-04. | S | design doc / ADR | M2-01 | ADR merged |
| **M2-03** | Create `@quagga/auth` package (better-auth 1.5.x + drizzle-adapter + passkey). | M | new package | M2-02 | package builds in isolation |
| **M2-04** | Generate Better Auth tables (user/session/account/verification) via CLI into `schema.ts`; produce **one** appended migration. | S | `packages/db/src/schema.ts` + new migration | M2-02, M2-03 | migration applies; tables exist |
| **M2-05** | Define shared `betterAuth()` config: email/password, Google, `crossSubDomainCookies`, Resend callbacks, `cookieCache`, `rateLimit.storage:'database'`, plugins twoFactor/passkey/haveIBeenPwned/captcha. | M | `@quagga/auth` | M2-03 | config typechecks; rateLimit is DB-backed |
| **M2-06** | Rewrite the 3 route handlers `app/api/auth/[...path]` → `[...all]` per app. | M | apps/{web,org,suppliers}/app/api/auth | M2-05 | auth routes respond |
| **M2-07** | Rewrite `lib/auth-client.ts` (all 3) to the Better Auth client. | S | apps/*/lib/auth-client.ts | M2-05 | client calls succeed |
| **M2-08** | Delete 3× `neon-auth.ts` + remove `@neondatabase/auth` dep; replace `NEON_AUTH_*` env with `BETTER_AUTH_SECRET`. | S | apps/*/lib, root deps, env | M2-06/07 | no `@neondatabase/auth` imports remain |
| **M2-09** | Branded reset/verify views (replace fallback Neon AuthView subpaths). | S | apps/*/app/auth | M2-06 | reset+verify render branded |
| **M2-10** | Absorb the 1.4→1.5 breaking changes; pin the validated version. | S | `@quagga/auth`, root overrides | M2-05 | build green on pinned version |
| **M2-11** | Set `crossSubDomainCookies.domain` + `trustedOrigins` (absolute, no wildcards) to the apex; verify SSO across the 3 apps. | S | `@quagga/auth` config + env | M2-01, M2-08 | one sign-in carries across subdomains |
| **M2-12** | Flip `auth-capabilities.ts`: twoFactor/backupCodes/passkeys/emailChange/unlink → `supported`; decide retire-vs-keep the probe as a kill-switch seam. | S | `packages/core/src/auth-capabilities.ts` | M2-05 | tests updated; surfaces stop refusing |
| **M2-13** | Build 2FA/TOTP + backup-codes enrolment flows behind the now-open seams. | M | apps/web account/security | M2-12 | enrol + verify + backup-code redeem works |
| **M2-14** | Build passkey enrolment flow (rpID = apex). | M | apps/web account/security | M2-11, M2-12 | register + sign-in with passkey works |
| **M2-15** | Wire real change-email + unlink commit (now that the server endpoints exist). | S | apps/web `lib/account-actions.ts` | M2-12 | email change lands; unlink verified |
| **M2-16** | Rewrite AGENTS.md rule 3 to pin the validated better-auth 1.5/1.6 version; add a CI pin-guard. | XS | AGENTS.md, CI | M2-10 | pin-guard fails on drift |
| **M2-17** | De-dup `email.ts` (currently identical in web + org) into a shared package; wire Resend into `betterAuth()` callbacks; decide if suppliers needs outbound email. | S | new shared module, apps/*/lib/email.ts | M2-05 | one email module; all senders use it |

---

## M3 — CORRECTNESS + QUALITY

**Goal:** close the three systemic voids — authz/privacy tested only as *predicates* not *wiring*, zero DB transactions, zero error/observability — and build the **E2E suite that covers every user journey across all three apps, auth included**. Make a dropped guard or a leaked PII field fail CI.
**Exit criteria:** (a) every server action has an authz-rejection + zod-rejection + happy-path test; (b) multi-write actions run in transactions; (c) the CI regression guards from auth-spec §5 exist; (d) observability shows whether auth is failing in prod; (e) **every journey in the E2E scope below has a passing Playwright spec, and the nightly full suite plus the PR smoke subset both run against a preview deployment.**

> **M3 is NOT gated behind M2.** The linear M0→M1→M2→M3→M4 spine is a presentation order, not a dependency chain for M3. **The only M3 work that hard-depends on M2 is M3-19** (the 2FA / passkey / change-email / unlink auth E2E — those capabilities are *structurally impossible* on managed Neon Auth, not merely unbuilt) and **M3-15's `BETTER_AUTH_SECRET`-drift alert** (needs the secret M2 introduces). **Everything else in M3 is M2-independent and SHOULD run in parallel with — or ahead of — M2**, because it guards live hazards the reality check calls systemic voids: M3-10 (transaction wrapping) mitigates the risk register's own Medium–High orphan-write hazard; M3-02/M3-03 (authz-wiring tests) and M3-06/M3-07 (PII-projection wiring tests) guard privacy invariants that are otherwise untested through M2 and the demo. Gating them behind the multi-week auth swap would leave orphan-writes and untested guards live during M2 itself. Run them concurrently; do not queue them behind M2.
>
> **E2E starts EARLY — right after M0, not after M2.** *"E2E must test everything, including auth."* (Ryan, 26 Jul 2026.) The E2E harness (M3-16), the mail-capture strategy (M3-17), **the auth journeys that are testable on today's auth (M3-18)**, and every product journey (M3-20 … M3-30) need only a deployed app and a database — i.e. M0. They are the fastest way to stop paying for manual smoke passes on every change, and they are what makes the seeding principle affordable: with no seeded content, *the tests create their own data*, exactly as a real user would. Only M3-19 waits for M2.

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M3-01** | Stand up an action-level test harness (mock session + pg-mem / test Postgres). | M | new test infra | — | one action test runs green |
| **M3-02** | Authz-wiring tests: `requireOrgSession({god:true})` throws for org_staff; `requireOnboardedUser` redirects on pending block; supplier action rejects a foreign `supplierId`. | L | apps/*/lib/session + action tests | M3-01 | guards proven, not just predicates |
| **M3-03** | Zod-rejection + audit-emission + happy-path row-shape tests for all 30 `'use server'` actions. | XL | apps/*/**/actions.ts (tests) | M3-01 | each action has ≥3 tests |
| **M3-04** | Tests for `apps/web/lib/groups-store.ts` free-camp visibility (extract the filter into a pure predicate). | M | apps/web/lib/groups-store.ts + test | — | stranger cannot discover a free camp (tested) |
| **M3-05** | Tests for the web gate helpers (`requireOnboardedUser`/`enforceGate`/`pendingBlockingRoute`). | M | apps/web/lib/session.ts + test | M3-01 | gate spine covered |
| **M3-06** | Privacy-wire test: bio-store persists enforced flags (prove the wire, not just `enforcePrivacyFlags`). | S | apps/web/lib/bio-store.ts + test | M3-01 | illegal-public coerced on write (tested) |
| **M3-07** | Privacy-wire test: supplier session/onboarding query never selects `notes`. | S | apps/suppliers/lib + test | — | notes provably absent from supplier reads |
| **M3-08** | DB migration-apply + constraint round-trip test (cascades, unique constraints, append-only invariant) against throwaway Postgres. | M | packages/db test | — | 13 migrations apply; cascades behave |
| **M3-09** | Consolidate web's duplicated gate idiom into one enforced choke point (layout/middleware) so a new page can't ship ungated. | M | apps/web layout/middleware | M3-05 | new page inherits gate by construction |
| **M3-10** | Wrap multi-write actions in `db.transaction()` — start with registerSupplier, createCamp, registration submit, questionnaire activate. | L | apps/*/**/actions.ts | — | partial-failure leaves no orphan (tested) |
| **M3-11** | CI: switch to 3 workflows (fast PR gate / post-merge Neon-Local migration-apply / nightly Playwright E2E); add PGlite integration + one Neon-Local driver-fidelity job. | L | `.github/workflows` | M0-16 | all three workflows run |
| **M3-12** | CI regression guards: authz-completeness matrix, PII-projection boundary, route-authz census, migration append-only+sync+apply. *(No "no-migrate-in-build" grep — that rule was reversed 26 Jul 2026: `db:migrate:deploy` now runs in every app's build by design, AGENTS.md rule 1. A guard forbidding migrate-in-build would flag the intended wiring.)* | L | CI + guard scripts | M3-11 | each guard fails on an injected violation |
| **M3-13** | Supply-chain CI: `pnpm audit`, gitleaks, trufflehog, CodeQL, Renovate cooldown. | M | CI | M3-11 | scans run on PR |
| **M3-14** | Observability: Grafana Cloud Free + OTLP-over-HTTP exporter (delta temporality, explicit flush) + structured JSON logs with PII redaction. | L | new `instrumentation.ts` per app | — | traces + logs reach Grafana |
| **M3-15** | Auth dashboard (12 panels) + alerting (credential-stuffing, Resend failure spike, auth-availability, `BETTER_AUTH_SECRET` drift; daily digest). | M | Grafana config | M3-14 | alert fires on simulated event |
### M3 E2E — the suite covers everything, auth included

**Scope statement (binding).** One Playwright suite, per `docs/auth-platform-spec.md` §5.2, covering **every user journey across all three apps** — not just auth, and not just happy paths. Concretely: burner sign-up → Burner Bio (incl. privacy toggles + hard-locked fields) → create camp → invite/join → registration wizard all six sections → submit → org review (approve / request changes) → the feedback loop → notification delivery → bulletin publish and receipt; MV and art registration; roles + officer assignment + consent accept; questionnaire build → activate → fill (incl. a **blocking** gate) → results; supplier self-register → onboarding steps → document acknowledgement → standing visible; account management (password change, session revoke, delete-with-grace); and the **authz negative paths** (a non-member cannot see a free camp, a non-org account cannot reach the console, a supplier cannot see org notes).

**Auth E2E specifically.** Sign-up · email verification · sign-in · wrong-password lockout/rate-limit · enumeration-safe messages · password reset end-to-end **including receiving the email** · session revoke · sign-out everywhere — **all of these are testable NOW against managed Neon Auth and must be written now (M3-18)**. 2FA enrol/challenge/backup-code and passkey register/authenticate (plus change-email and unlink) are **structurally impossible on managed Neon Auth today** — Neon owns the server config and disallows custom Better Auth plugins — so they land with M2 (M3-19). That split is the whole reason auth E2E is no longer one M2-blocked task.

**Where E2E runs.** Against a **Vercel preview deployment pointed at a Neon branch**, never production: the suite signs up real accounts and writes real rows, and with nothing seeded it *must* create its own data. The branch is deleted on run completion (auth-spec §5.2's free-tier mitigation).

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M3-16** | **E2E harness + fixtures (barrier).** New `e2e/` workspace package: Playwright config with `baseURL` per app (web/org/suppliers), projects for desktop + 360px mobile, trace/video/screenshot on failure, `concurrency`-safe parallelism. Fixtures: a per-worker unique-email factory, `signUpBurner()` / `signInAs()` / `elevateToGod()` helpers, a `freshCamp()` builder that drives the real UI (no DB back-doors), and teardown that removes what the run created. **No shared mutable fixture state** — every spec creates its own burner. | M | new `e2e/` package, `turbo.json` | M0 (deployed app + DB) | one trivial spec (load web, assert app shell) goes green against a preview URL |
| **M3-17** | **Mail capture for CI.** Email-dependent flows (verification links, reset links, digests, notification emails) need a way to *read* mail in CI. **Options, honestly:** (a) **Disposable-inbox API** — the repo already ships an **`agent-inbox` skill** (mail.tm with a 1secmail fallback) that mints temporary addresses and polls them; free, and it exercises the **real** delivery path (Resend → DNS → inbox), which is the point of an E2E. Costs: third-party availability/rate limits, needs a verified Resend sending domain, adds seconds of polling latency. (b) **Mailpit/MailHog service container** — deterministic, but only works if the app's transport is SMTP-switchable *and* reachable from the deployment; a Vercel preview cannot reach a CI-local container, so it would force E2E onto a self-hosted app and stop testing the real deployment. (c) **A test-only signed "peek the latest token for this email" endpoint**, gated behind a secret that is unset in production. Fast and deterministic, but it is a deliberate auth side-door in the product codebase. (d) **Better Auth `getOTP()` / `getTestInstance()`** — in-process only (auth-spec §5.3), useless against a deployed preview, and post-M2 only. **PICK: (a) `agent-inbox` disposable inboxes** as the primary strategy — it is free, it needs no product-code changes, and it proves the delivery path end-to-end. **Fallback, only if third-party flakiness makes the nightly unreliable: (c)**, and if it is ever added it ships *with* a CI guard asserting the endpoint hard-refuses when its secret is unset plus a route-census entry, never silently. | S | `e2e/` fixtures, Resend sending domain | M3-16 | a spec receives a real verification email and extracts its link |
| **M3-18** | **Auth E2E — testable on TODAY's auth (NOT blocked by M2).** Sign-up (incl. duplicate-email path); email verification via M3-17; sign-in; sign-out; **wrong-password lockout / rate-limit** (repeat failures are throttled — and assert it throttles *across* requests, the `rateLimit.storage` trap); **enumeration-safe messages** (sign-in and forgot-password say the same thing for an unknown vs known address); **password reset end-to-end including receiving the email** and confirming old sessions die; session list + **revoke a single session**; **sign out everywhere**. | L | `e2e/auth/*.spec.ts` | M3-16, M3-17 | each flow green against a preview; rate-limit + enumeration assertions fail if the guard is removed |
| **M3-19** | **Auth E2E — M2-only (structurally impossible on managed Neon Auth).** 2FA/TOTP enrol → challenge on next sign-in → **backup-code redeem**; passkey **register + authenticate** (Playwright CDP virtual authenticator, `rpID` = apex); change-email with its confirm/revoke window; provider unlink. Also assert cross-subdomain SSO (one sign-in carries to org + suppliers). | M | `e2e/auth/*.spec.ts` | **M2-11/12/13/14/15**, M3-18 | flows green nightly on the self-hosted auth |
| **M3-20** | **Journey: burner onboarding.** Sign-up → Burner Bio completion → **privacy toggles honoured** on the public profile → **hard-locked fields (phone, emergency contacts, ID/passport) are absent from every public surface regardless of toggle state** → the blocking onboarding gate releases once the bio is complete. | M | `e2e/web/*.spec.ts` | M3-16 | a hard-locked field appearing anywhere public fails the spec |
| **M3-21** | **Journey: camp creation + membership.** Create a camp → invite a second burner → the invitee joins → roster shows both → the structural `lead`/`admin` backstop holds (a lead can never be locked out of their own camp). | M | `e2e/web/*.spec.ts` | M3-16 | second account joins and both see the roster |
| **M3-22** | **Journey: registration wizard.** All six sections filled → resume a half-finished draft in a new session → invalid/incomplete submit is refused → submit succeeds and the state machine lands on `submitted`. | L | `e2e/web/*.spec.ts` | M3-21 | wizard completes; draft resume preserves answers |
| **M3-23** | **Journey: org review loop.** Org opens the queue → registration detail → **request changes** on a section → camp side sees the feedback → camp edits + resubmits → org **approves**. Assert both terminal branches (approve *and* changes-requested) and the state transitions between them. | L | `e2e/org/*.spec.ts` + web | M3-22 | both branches green; illegal transition refused |
| **M3-24** | **Journey: notifications + bulletins.** The review-feedback notification reaches the camp's notification panel (and its email, via M3-17); org composes and publishes a bulletin; the targeted audience receives it **and a non-targeted account provably does not**. | M | `e2e/org` + `e2e/web` | M3-23 | delivery asserted on the target; **absence asserted on a non-target** |
| **M3-25** | **Journey: MV + art registration.** Register a mutant vehicle and an artwork through their own flows; confirm the camp wizard stays gated to `theme_camp` (no MV/art field overwrite). | M | `e2e/web/*.spec.ts` | M3-21 | both project kinds register; gating holds |
| **M3-26** | **Journey: roles + officers.** Create a custom role and grant privileges → assign it → **officer registration**: offer an officer role, accept the consent, and assert the officer's phone becomes org-visible **only after acceptance** (the single sanctioned phone-sharing path) and never before. | M | `e2e/web` + `e2e/org` | M3-21 | pre-consent org view has no phone; post-consent it does |
| **M3-27** | **Journey: questionnaires.** Org builds a questionnaire in builder-v2 (several question types + a content block + one branch) → activates it against an audience → the targeted burner fills it → **results aggregate correctly**. Include a **BLOCKING** activation: the gated user can reach only the fill page and sign-out, and is released on submit. | L | `e2e/org` + `e2e/web` | M3-21 | blocking gate provably traps and releases; results match the answers given |
| **M3-28** | **Journey: suppliers.** Self-register with an email that overlaps a seeded catalog row (**claim-by-email** attaches to the existing accountless row) and one that does not (fresh row) → walk the onboarding steps → acknowledge a document → standing chip visible in the portal and in the camp-side picker. | M | `e2e/suppliers/*.spec.ts` | M3-16 | both registration paths land correctly; document acknowledgement persists |
| **M3-29** | **Journey: account management.** Password change (and old sessions invalidated) → session revoke → **delete-with-grace** (account enters the 14-day grace, is restorable within it, and the surfaces honestly report what is and is not available). | M | `e2e/web/account/*.spec.ts` | M3-18 | grace entered + restored; capability states honest |
| **M3-30** | **Journey: authz negative paths (adversarial).** A stranger cannot discover or open a **free camp** (directory, profile, type-ahead all enforce it); a non-org account gets refused by the org console; a supplier account cannot read org-internal supplier **notes**; a camp member cannot read another camp's registration; a non-god cannot reach god-only surfaces. Every assertion is "the guard **refuses**", not "the link is hidden". | L | `e2e/**` | M3-20, M3-21, M3-28 | each negative path fails closed; removing a server-side guard turns a spec red |
| **M3-31** | **CI wiring for E2E.** **PR: a smoke subset** (~5 min — app shells load, sign-up + sign-in, one registration submit, one org review, one negative-path spec) so a PR cannot merge a broken core loop. **Nightly: the full suite**, all projects incl. 360px. Trigger on the GitHub **`deployment_status`** event to get the Vercel preview URL (never race the build; `wait-for-vercel-preview` polling as fallback), send the **`x-vercel-protection-bypass`** header or Playwright silently hangs on Deployment Protection, point the preview at a throwaway **Neon branch** and **delete the branch on completion**. Upload traces/videos as artifacts on failure. Public repo ⇒ standard runners are unmetered, so the real budget is Neon compute-hours and wall-clock — which is why the full suite is nightly and only the smoke subset is per-PR. | M | `.github/workflows`, `e2e/` | M3-11, M3-16 | PR smoke blocks a deliberately-broken sign-in; nightly full suite reports green with artifacts on failure |

---

## M4 — FEATURE COMPLETION

**Goal:** ship the deferred first-party capabilities and close the design-gap register's schema/feature majors. Schema-first: every table lands (single owner) before its consumers.
**Exit criteria:** wrangler, uploads, grids, MV/art edit-resubmit, reply threads, supplier bulletins, Form-2, ERFs, digest cron all functional; the 50 minors triaged.

**Schema-owning tasks (barrier — must land first, one owner each):**

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M4-01** ✅ | `wrangler_assignments` table + append-only migration (org member × approved camp × edition). | M | `schema.ts` + migration | ~~AB confirm mechanics (#61)~~ — shipped under stated assumptions, see below | DONE 29 Jul 2026: migration 0026 applied + verified; unique (group, edition) |
| **M4-02** ✅ | Reply model on `section_reviews` (append-only migration) for the two-way review conversation (M3/#reply). | M | `schema.ts` + migration | schema design owner | migration applies | DONE — `section_review_replies` (schema.ts) ships the reply model.
| **M4-03** ✅ | Supplier `AudienceSpec` kind + resolver (M14) so bulletins can reach suppliers. | M | `packages/types/audience.ts`, core resolver | — | resolver returns **ONLY** suppliers and **strips hard-locked fields** — a non-supplier account and a hard-locked field are both provably absent from the result (tested, adversarial) | DONE — `org_suppliers` resolves in @quagga/core `audience.ts`.
| **M4-04** | Security-events model — new table *or* a queryable view over audit_events + email_change + deletion + sessions. | M | `schema.ts` / view | **Decision (write it down, ADR-style): table-vs-view.** Owner = schema owner + security reviewer; must be resolved *before* the schema owner reaches M4-04 in wave 4a (same discipline as M2-02's gate), else the single schema owner stalls or guesses mid-chain. | feed query returns rows |
| **M4-05** | Seen-device-fingerprints column/table per account (new-device alert persistence). | S | `schema.ts` + migration | — | migration applies |
| **M4-06** | Digest sent-marker column (append-only) for the notification cron. | XS | `schema.ts` + migration | — | migration applies |
| **M4-07** | Staff-assigned ERF/location fields on the per-edition camp record (R1 interim placement). | S | `schema.ts` + migration | — | field editable by org |

**Consumer/feature tasks (after their schema barrier):**

| id | scope | size | touches | blocked by | verified by |
|---|---|---|---|---|---|
| **M4-08** ✅ | Wrangler board UI (`/wranglers`) + assign affordance on the org review screen; `wranglerAssignedNotification` wired; Overview tile flipped live. | L | apps/org | M4-01 | DONE 29 Jul 2026. The leak clause is `specs/org-staff/wrangler-assignment.spec.ts`: another camp's lead and another org member are both in the room and both assert absence. |

**M4-01 shipped without the AB discovery answer, under three stated assumptions.**
The blocker was "exact mechanics unknown". Two of the three questions turned out
to be already answered by the model, and the third had a defensible default:

  1. *When?* AfrikaBurn assigns at Form-1 acceptance (`docs/synthesis.md`), and
     this model has no Form-1/Form-2 split — our single registration approval IS
     that acceptance. The apparent conflict with "post-approval" was not one.
  2. *How many?* One per camp per edition, enforced by a unique index.
     AfrikaBurn's own words are singular; a camp with two has none.
  3. *Milestones?* Not stored. Everything worth showing today is derivable, and
     storing a copy would mean rendering values nobody sets as fact.

If AB's answer differs, (2) is a dropped index and (3) is a new table — neither
touches the assign flow. (1) changes only which status unlocks it.
| **M4-09** ✅ | Registration feedback reply UI (camp-side author + display on summary & wizard). | M | apps/web registration components | M4-02 | camp posts a reply; org sees it | DONE — `SectionReplyThread` is mounted in BOTH the summary and the wizard. Proven end to end 29 Jul by `specs/camp-lead/review-loop.spec.ts`, which also checks the reviewer can READ the reply — the half nobody had verified.
| **M4-10** ✅ | MV / art edit-resubmit flows (load existing responses → resubmit into the state machine, which already supports resubmit). | M | apps/web vehicles/artworks forms | — | MV/art registration editable + resubmittable | DONE — `/artworks/[slug]/edit` + `/vehicles/[slug]/edit`, each running its own submit gate. Covered by `specs/new-burner/art-and-vehicle-registration.spec.ts`.
| **M4-11** ✅ | Questionnaire grid types (multiple-choice grid + checkbox grid): PaletteKind + zod schema + block editor + runner render + results aggregation. | L | `@quagga/core`, apps/org builder, apps/web runner | — | grid authored, answered, aggregated | DONE — `multi_choice_grid` + `checkbox_grid` in packages/types `questionnaire.ts`.
| **M4-12** ✅ | Questionnaire author preview mode (render current definition through runner, read-only). | M | apps/org builder-v2 | — | preview renders before Send | DONE — `apps/org/components/questionnaires/questionnaire-preview.tsx`.
| **M4-13** | Questionnaire edit-after-submit toggle + confirmation message (jsonb definition fields, no migration). | S | `packages/types/questionnaire.ts`, builder, runner | — | toggle + message honoured |
| **M4-14** ✅ | Supplier bulletins: add the supplier option to the compose audience picker; fan-out reaches suppliers. | S | apps/org bulletins compose | M4-03 | bulletin lands in supplier portal; **and a supplier-targeted bulletin does NOT reach any non-supplier audience — no over-broadcast (tested, negative path)** | DONE — the Suppliers option is in `BULLETIN_AUDIENCE_OPTIONS`; the org→suppliers fan-out is proven cross-app by `specs/org-staff/bulletins-audience-reach.spec.ts` (published on :3001, read on :3002, with a camp lead as the no-leak control).
| **M4-15** | Security-events feed on `/account/security`. | M | apps/web account/security | M4-04 | feed shows real events |
| **M4-16** | Wire new-device sign-in alert to fire only on genuinely new fingerprints. | S | `@quagga/core` + web sign-in path | M4-05 | fires once per new device (tested) |
| **M4-17** | Notification digest cron: choose infra (Vercel Cron vs Inngest), add trigger + bearer secret + batching. | M | web digest route + scheduler | M4-06 | digest sends on schedule |
| **M4-18** ✅ | Turn questionnaire file-upload + image content blocks from URL-only into real Blob uploads (type/size/count limits). | M | apps/web runner + upload route | M0-11 | file persists; limits enforced | DONE — questionnaire file/image blocks go through the shared `FileUpload` (real Blob when BLOB_READ_WRITE_TOKEN exists, URL-paste fallback otherwise).
| **M4-19** ✅ | Supplier-document real file uploads via Blob. | S | apps/suppliers + org documents | M0-11 | doc uploads persist | DONE — supplier documents use the same primitive.
| **M4-20** | Form-2 as an org questionnaire targeting registered_camp_leads: split the size/placement/sound/layout sections into a Form-2 template; scheduled release + audience targeting (machinery already exists). | M | apps/org questionnaire template + apps/web wizard split | — | Form-1 vs Form-2 separated |
| **M4-21** ✅ | Extract shared account UI into `@quagga/ui`; mount the account suite in org + suppliers (backend already app-agnostic). | M | `@quagga/ui`, apps/org, apps/suppliers | M2-* (auth) | /account works in all 3 apps | DONE — read side extracted to `@quagga/auth/account`, presentation to `@quagga/ui/components/account-*`; `/account`, `/account/security` and `/account/delete` mounted in org + suppliers in their own route group, deliberately outside each app's gate (an ex-organiser and an unlinked supplier must still be able to secure their account). Deletion stays single-owner on apps/web; the other two explain and hand over. Covered by `specs/org-staff/account-suite.spec.ts` + `specs/supplier/account-suite.spec.ts`. Found and fixed a live defect on the way: `auth.api.*` called from a server action had its `Set-Cookie` dropped, so a password change left the browser on a deleted session until the 5-minute cookie cache ran out.
| **M4-22** | Previous-year duplication + change-comparison: clone prior-edition registration into a draft; delta view; expiry flags. | L | apps/web registration + core diff | ≥1 prior edition of real data | returning camp confirms deltas |
| **M4-23** | Minors triage: batch the ~17 copy-mismatches; decide the canvas-is-wrong ones; schedule the genuine missing interactions (strength bar, eye toggle, brand marks). | L | across all apps + `@quagga/ui` | — | minors closed or explicitly parked |
| **M4-24** | Per-option description field on `QuestionOption` (sc1). | XS | `packages/types/questionnaire.ts` + editor | — | option description authored + rendered |
| **M4-25** | **`component-spec.md` census reconciliation** (distinct from M4-23, which only covers `design-gap-register.md`): reconcile the 62-component census against the ~36 shared + app-local components actually present; confirm nothing spec'd is missing, and either build/park each gap. Without this the technical-inventory "reconcile… confirm nothing spec'd is missing" item is silently dropped. | S | `packages/ui`, `docs/component-spec.md` | — | every spec'd component is present or explicitly parked; census closed |

---

## M5 — PLATFORM (parked; sequence only after real adoption)

**Goal:** the platform bets. None are on the current critical path; each is gated on a real-world confirmation. Listed for completeness and to keep scope decisions documented.

| id | scope | size | blocked by |
|---|---|---|---|
| **M5-01** | Third-party IdP ("Sign in with AfrikaBurn"): separate auth-service on better-auth 1.5+ oauthProvider (authorize/token/userinfo/consent/JWKS/discovery). | XL | real adoption; M2 done; Neon-support answers |
| **M5-02** | Org Integrations console (client registration, secret rotation, scopes, consent, revocation) + scoped `/api/me` with hard-locked-field stripping. | L | M5-01 |
| **M5-03** | Camp 404 integration: point at the shared auth + publish pinned `@quagga/db-schema`; validate multi-app-single-instance auth. | L | M2 (shared apex/Neon), #63 |
| **M5-04** | Platform-as-backend: public API + MCP server as its own app. | XL | untrusted external consumers; after design pass |
| **M5-05** | Containers app (registry, booking wizard, slots/convoys, 12-state lifecycle, coordinator ops, driver manifest). | XL | AB container data/format; before build-week 2027 |
| **M5-06** | Attestations / offline QR handshake / PWA (device_keys + attestations tables, WebCrypto sign/scan/verify/countersign, pre-event sync). | XL | arrives with logistics apps |
| **M5-07** | Water / Ice / Gas logistics on the request-queue pattern. | XL | AB discovery; attestation primitive; containers priority |
| **M5-08** | Payment gateway integration (only if AB wants in-app checkout; SA provider accepting intl Visa/MC). | L | AB fee-collection decision, merchant account |
| **M5-09** | Contractor/handover roles (drivers, collection person) — magic-link/PIN + device key. | L | containers + attestation primitive |
| **M5-10** | Collectives (formerly "villages"), camp-internal tooling, working-budget/compliance, WhatsApp/SMS — each graduates individually only on validated demand. | L–XL | demand validation per topic |

---

## 2. THE FAN-OUT PLAN

This is the part Ryan asked for: exactly how the work parallelises without agents colliding. The project has learned the collision lessons the hard way — they are encoded as rules below.

### Standing rules (apply to every wave)

1. **One agent per app/package per wave.** `apps/web`, `apps/org`, `apps/suppliers`, `@quagga/core`, `@quagga/ui`, `@quagga/db`, `@quagga/types` are the ownership units. Two agents never edit the same unit in the same wave.
2. **Shared chrome has exactly one owner.** App-shell, nav, header, and any `@quagga/ui` primitive touched this wave is assigned to a single agent; everyone else consumes, no one else edits.
3. **Migrations have a single owner per run.** Only one agent touches `schema.ts` + `packages/db/migrations` in any given wave. Append-only is non-negotiable. A wave that needs two tables gives both to the same schema agent, serially.
4. **Dependency/version changes are isolated to their own wave.** Bumping better-auth, adding a package, changing pnpm overrides = a dedicated wave with nothing else in it (M2-03/M2-10 are examples).
5. **Barriers: schema before consumers, primitive before adopters.** No consumer task starts until its schema/primitive task has merged and CI is green. This is a hard gate, not a soft preference.
6. **Agents must NOT self-certify design conformance.** An agent that builds a surface cannot be the one that declares it matches the frame. Design conformance is checked by a separate pass (a DesignSync/adversarial reviewer), because self-certification is how the 50 minors accumulated.
7. **Cross-cutting defects need a cross-cutting auditor.** The table→card reflow, PII-projection, and authz-census classes are single-root-cause problems spanning many files; they get one owner who fixes the root and one auditor who verifies the whole class — never fanned out per-file.
8. **Gate/commit discipline between waves.** Each wave ends with `pnpm turbo run lint typecheck test build` green + the wave's own verification, one squash-reviewable commit per ownership unit, and an explicit human/lead gate before the next wave opens. No wave starts on top of a red build.

### Per-milestone fan-out

**M0 — mostly serial, small parallel tail.**
- **Wave 0a (serial, single owner):** M0-01 → M0-02 → M0-07 → M0-08. The DB spine is one hand only; migrations + the reference seed cannot be parallelised.
- **Wave 0b (parallel, 3 agents, one per Vercel project):** M0-03 (web), M0-04 (org), M0-05 (suppliers) + M0-06/M0-09 (config/docs owner). No file overlap.
- **Wave 0c (serial pre-step, single owner, RUNTIME not code):** M0-12 — create the demo data **live through the app**: sign up as a real burner, verify the email, register Camp 404 through the wizard, and elevate the `GOD_EMAILS` account on org. This gates the web/org smoke tests, because with nothing seeded there is no other way for a row to exist. *(This wave used to be a `seed.ts` `authUserId` back-fill; that task is deleted — the seeding principle removed the need for it entirely.)*
- **Wave 0d (parallel, 3 agents, one per app, runtime):** M0-13 / M0-14 / M0-15 smoke tests + M0-10/M0-11 env. Each agent owns one app; findings funnel to M0-17. **M0-15 (suppliers) does not depend on 0c** — the supplier portal self-registers its own account, so it can run as soon as 0a + its env land.
- **Barrier:** 0a (migrate + reference seed) before 0c; 0a **and** 0c before the web/org halves of 0d (no smoke test of a queue that has nothing in it yet). The suppliers smoke test is exempt.
- **No adversarial pass needed** — this is ops, verified by the app loading.

**M1 — parallel by app, one shared-UI owner.**
- **Wave 1a (parallel, 3 agents):** M1-01 (web), M1-02 (org), M1-03 (suppliers) error/not-found boundaries — strictly per-app, zero overlap. **M1-04 (loading skeletons) may fold into this same wave per app** — same per-app owner, separate route files (`loading.tsx` vs `error.tsx`/`not-found.tsx`), no ordering dependency — so it need not wait for a 1b, avoiding an idle per-app agent.
- **Wave 1b (parallel):** M1-04 loading skeletons if not already folded into 1a (per-app, same owners), M1-05 (suppliers session), M1-06/M1-07/M1-08 (org). **M1-08 folds into the org agent** — it now only *consumes* the already-built `@quagga/ui` markdown-editor in org compose, so there is no `@quagga/ui` edit and no primitive-before-adopter coupling; it runs serially inside the org agent alongside M1-06/M1-07. *(The former standalone "Wave 1c" for M1-08 is dissolved — it existed only under the false assumption that the primitive had to be built here.)*
- **Adversarial pass required** on M1-07: the responsive-table/confirm-dialog fixes were self-certified in a prior commit; a separate agent must confirm them on real data at 360px (rule 6).
- **M1-10 defect drain** is assigned by which app/package each defect lands in — never a shared "fix everything" agent.

**M2 — the most serial milestone; treat as a chain with two isolated dependency waves.**
- **Wave 2a (decisions, single owner, blocking):** M2-01 apex + M2-02 the two irreversible ADRs. Nothing else runs until these merge (rule: irreversible decisions gate table generation).
- **Wave 2b (dependency isolation, single owner, nothing else):** M2-03 create `@quagga/auth` + M2-10 absorb 1.5 breaking changes. This is a version wave (rule 4) — no feature work concurrent.
- **Wave 2c (schema, single owner):** M2-04 generate auth tables + the one migration. Only the schema agent touches `@quagga/db`.
- **Wave 2d (parallel, 3 agents, one per app):** M2-06/M2-07/M2-09 route + client + branded views — each app owns its own `app/api/auth` and `lib`. M2-05 config is owned by the `@quagga/auth` agent (its own package — no per-app lib touched). **M2-08 does NOT run here.** M2-08 deletes `apps/{web,org,suppliers}/lib/neon-auth.ts` and rewrites `NEON_AUTH_*` env — it reaches into all three apps' `lib` dirs, which the per-app agents are editing this same wave. Running it concurrently would break standing rule 1 (one agent per app per wave) and is a guaranteed mid-M2 merge collision. Hold it for the cleanup wave.
- **Wave 2d-cleanup (short, serial, single owner — after 2d merges green):** M2-08 delete 3× `neon-auth.ts` + drop `@neondatabase/auth` dep + swap `NEON_AUTH_*` → `BETTER_AUTH_SECRET`. Runs only after the per-app route/client/view rewrites have merged, so one agent can sweep all three `lib` dirs with no other diff open against them. *(Alternative if you'd rather not add a wave: fold each app's own `neon-auth.ts` deletion + env swap into that app's M2-06/07/09 task and delete M2-08 as a standalone — never have the auth agent edit per-app `lib` concurrently with the per-app agents.)*
- **Wave 2e (serial on M2-05):** M2-11 SSO, M2-12 capability flip (`@quagga/core`), then M2-13/M2-14/M2-15 enrolment flows (apps/web, one agent) + M2-16/M2-17 (CI/email owner).
- **Adversarial pass required** on M2-11/M2-12: SSO and the capability flip are security seams — an auditor must confirm no surface still refuses, and no cross-subdomain cookie leaks (rule 7).

**M3 — parallel by concern, with one test-harness barrier.**
- **Runs alongside M2, not after it.** Waves 3a–3e are M2-independent and should be scheduled concurrently with the M2 waves (they touch tests/CI/observability/E2E, not the auth rewrite). The **only** M3 work that waits on M2 is **M3-19** (2FA/passkey/change-email E2E — impossible on managed Neon Auth) and the `BETTER_AUTH_SECRET`-drift alert portion of **M3-15**. Hold just those two; start the rest in parallel. **Wave 3e (E2E) in particular should open the moment M0 closes** — earlier than 3a, if agents are available.
- **Wave 3a (barrier, single owner):** M3-01 test harness + M3-08 DB test infra. Everything downstream depends on the harness.
- **Wave 3b (parallel, by ownership unit):** M3-02/M3-03 action tests (split by app: web-actions agent, org-actions agent, suppliers-actions agent — actions live in different apps, safe to parallelise), M3-04/M3-05/M3-06 (web), M3-07 (suppliers).
- **Wave 3c (single owner each, cross-cutting):** M3-09 gate choke-point (web), M3-10 transactions (spans apps — one owner, because it's a single discipline applied uniformly; rule 7).
- **Wave 3d (parallel, CI/observability, separate from app code):** M3-11/M3-12/M3-13 (CI owner), M3-14/M3-15 (observability owner). These touch `.github` and `instrumentation.ts`, not app logic. Likewise M3-15's `BETTER_AUTH_SECRET`-drift alert waits on M2; its other panels do not.
  - **Scoped rule-1 exception (asserted narrowly, not blanket):** M3-14 adds a *new* `instrumentation.ts` to each app while wave-3b action-test agents work inside those same apps. This is permitted **only** because the observability owner touches exactly one new file per app (`instrumentation.ts`) that no 3b agent opens, and touches no existing app source. If M3-14 ever needs to edit existing app files (e.g. wiring a logger into an action), it moves to a separate wave from 3b — the exception does not generalise beyond the new-file case.
- **Wave 3e — E2E (its own ownership unit, starts right after M0, runs concurrently with 3a–3d and with all of M2).** The `e2e/` package is a **new workspace unit with a single owner per wave** (rule 1), and it edits **no app source** — so it collides with nothing. Sequence inside it:
  - **3e-barrier (single owner, serial):** M3-16 harness/fixtures → M3-17 mail capture. Nothing else in 3e starts until both are green (rule 5 — primitive before adopters; every journey spec consumes these fixtures).
  - **3e-wide (parallel, by app surface — one agent per app's spec dir, mirroring rule 1):** web-journeys agent (M3-18 auth-today, M3-20, M3-21, M3-22, M3-25, M3-29), org-journeys agent (M3-23, M3-24, M3-26, M3-27 — these span org **and** web UI, so they are given to *one* agent each end-to-end rather than split mid-journey), suppliers agent (M3-28). Splitting a single journey across two agents is the one shape to avoid: a journey spec is indivisible.
  - **3e-negative (single owner, after 3e-wide):** M3-30 authz negative paths — cross-cutting by nature, so one owner, per rule 7.
  - **3e-ci (CI owner, may overlap 3e-wide):** M3-31 wiring. Runs with the M3-11 CI owner, not against them.
  - **3e-post-M2 (after M2 lands):** M3-19 — the only E2E task that waits.
- **Adversarial pass required** on M3-12 guards: each guard must be proven by injecting a violation and watching CI fail (a guard that never fails is worse than none). **And on M3-30**: the negative-path suite must be proven by *deleting a server-side guard* and watching the spec go red — a negative-path test that passes with the guard removed is the exact failure mode it exists to prevent.

**M4 — schema-barrier then wide fan-out.**
- **Wave 4a (barrier, single schema owner, serial):** M4-02 → M4-04 → M4-05 → M4-06 → M4-07 → **M4-01 last** (and M4-03 types, order-independent). All schema/migration work by **one** agent, serially, in append-only order (rule 3). This wave contains no consumer work. **M4-01 (`wrangler_assignments`) is blocked by an external human decision — "AB confirm mechanics (#61)" — so it must NOT sit at the head of the chain: doing so would stall all the independent schema work (reply model, security-events, device fingerprints, digest marker, ERF fields) behind a discovery decision none of them depend on.** Append-only only requires each migration be a new file in commit order; it does *not* require the wrangler table first. **The chain therefore proceeds without M4-01, and M4-01 is appended last once AB confirms — if AB has not confirmed by the time the rest of 4a is done, M4-01 drops off the critical path and lands whenever the decision arrives, without blocking wave 4b consumers other than M4-08.** One more gate inside 4a: **M4-04's table-vs-view choice must be decided (ADR-style, owner = schema owner + security reviewer) before the schema owner reaches it**, or the single serial owner stalls/guesses mid-chain — same discipline that M2-02 got for its irreversible choice.
- **Wave 4b-grids (isolated sub-wave, single pair, runs before OR after 4b-wide — never concurrent with it):** M4-11 questionnaire grids **only**. Because grids cross `@quagga/core` (engine + results) → `apps/org/components/questionnaires/builder-v2.tsx` (block editor) → the `apps/web` runner (render), the grid pair is the **sole owner of all three of those files for this sub-wave**. No other task touching core, `builder-v2.tsx`, or the web runner runs concurrently. This is the fix for the earlier contradiction: M4-11 is *not* also assigned to the `@quagga/core` agent below, and it is *not* fanned across three app agents — it is one feature, one pair, one sub-wave (rule 1/5/7).
- **Wave 4b-wide (wide parallel, by ownership unit — sequenced before or after the grids sub-wave so it never shares core / builder-v2 / runner with M4-11):** once 4a merges green —
  - `@quagga/core` agent: M4-16 new-device logic, M4-24 option description. *(M4-11 removed — it owns core in its own sub-wave.)*
  - `apps/org` agent: M4-08 wrangler board, M4-12 preview (edits `builder-v2.tsx`), M4-14 supplier bulletins, M4-20 Form-2 template.
  - `apps/web` agent: M4-09 reply UI, M4-10 MV/art edit, M4-13 edit-after-submit runner (edits the runner), M4-15 security feed, M4-18 uploads, M4-22 duplication.
  - `apps/suppliers` agent: M4-19 doc uploads.
  - `@quagga/ui` agent: M4-21 shared account components (then org+suppliers mount — sequenced, primitive-before-adopters), M4-25 component-spec census reconciliation.
  - CI/infra agent: M4-17 digest cron.
- **Sequencing note:** M4-12 (builder-v2 preview) and M4-13 (web runner) share files with M4-11; M4-16/M4-24 share `@quagga/core` with M4-11. All four therefore run in a *different* sub-wave from M4-11 — before or after the grids sub-wave, never in the same wave.
- **M4-23 minors** is a dedicated triage owner + adversarial design reviewer (DesignSync), never spread across feature agents (rule 6 — that's how they were missed).
- **Adversarial pass required** on M4-08 (wrangler notification fan-out — must not leak), M4-14 (supplier audience resolver — must not over-broadcast), and M4-23 (design conformance).

**M5 — not fanned out yet.** Each item is its own project/app with its own gate; sequence only after real adoption confirms the need. When they start, M5-05/06/07 share the offline/attestation problem space with Camp 404 and must share patterns, not duplicate them.

### Where the barriers are (summary)
- M0-07/08 (migrate + reference seed) before any smoke test; **M0-12 (live-created burner + Camp 404) before the web/org smoke tests** — with nothing seeded, there is no data until a human makes some.
- M2-02 (irreversible ADRs) before M2-04 (generate tables).
- M2-04 (auth tables) before route/client rewrites.
- M3-01 (harness) before any action test.
- **M3-16 + M3-17 (E2E harness + mail capture) before any journey spec.**
- M4-4a schema before its consumers — but **per-table, not all-or-nothing**: each consumer waits only on its own schema barrier (M4-08 on M4-01, M4-09 on M4-02, M4-14 on M4-03, M4-15 on M4-04, M4-16 on M4-05, M4-17 on M4-06), so the externally-blocked M4-01 gates only M4-08, not the rest of wave 4b.
- Any `@quagga/ui` primitive before its adopters.

### Where an adversarial verification pass is mandatory (and why)
- **M1-07** — prior self-certified design fix; needs independent runtime confirmation.
- **M2-11/M2-12** — auth/SSO/capability seams; a mistake leaks sessions or silently disables a guard.
- **M3-12** — regression guards are worthless unless proven to fail on a real violation.
- **M3-30** — the E2E authz negative paths; same logic, proven by removing a server-side guard and watching the spec go red.
- **M4-08/M4-14** — audience fan-out; the failure mode is a privacy leak or a mis-broadcast.
- **M4-23** — design conformance, precisely because building agents cannot certify their own frames.

---

## 3. Risk register

| Risk | Likelihood | Mitigation | Early-warning signal |
|---|---|---|---|
| First DB boot surfaces data-shape/query defects across many surfaces at once. | **High** | M0 before everything; per-app smoke agents funnel to one triage list (M0-17 → M1-10); expect defects, budget M1-10 as M–L. | Any 500 on a primary page during M0-13/14/15. |
| Kickoff demo run on imagined data / green CI mistaken for a working app. | High | Hard gate: demo script must run on prod data (M1 exit). No demo on `*.vercel.app` + no DB. **Nothing is seeded, so a rehearsal that shows data at all is proof the write paths work.** | Demo rehearsal never touched a real row. |
| **Empty-state surfaces read as broken at the kickoff** (nothing is seeded, so the directory/queue/status board start empty). | **Medium** | M1-01/02/03 boundaries + honest empty states; M0-12 creates the demo data live *before* anyone watches; M1-09 rehearses the sequence so the first thing the audience sees is a camp being registered, not a blank table. | An M0 smoke test reports "page is empty" as a defect rather than as correct. |
| **A future task quietly re-seeds user content** ("just one camp so the page isn't empty"). | Medium | The seeding principle is stated in `seed.ts`'s header, `docs/deploy.md` and §0 of this roadmap. Any PR adding `users`/`groups(theme_camp)`/`memberships`/`registrations` writes to `seed.ts` is a spec violation, not a convenience. Candidate CI guard: grep `seed.ts` for those table writes. | A diff on `seed.ts` inserts a person. |
| Auth migration (M2) done *after* users enrol → `rpID`/table-boundary become un-migratable. | Medium | Do M2 greenfield **now**, before real users; M2-02 ADR gates table generation. | Any real user sign-up before M2 lands. |
| `rateLimit.storage` left at `'memory'` (per-lambda, silently non-functional). | Medium | Explicit task M2-05 sets `'database'`; M3-15 alert on auth anomalies would catch a silent gap. | Rate-limit never trips under load. |
| Zero transactions → partial-failure orphans once real writes run. | Medium–High | M3-10 wraps the linked-row actions; M3-08 constraint tests catch orphans. | An action fails mid-sequence and leaves a half-written row. |
| Agents self-certify design/authz → same class of misses as the 50 minors. | High (proven) | Rules 6 & 7: separate adversarial/DesignSync pass on every flagged wave. | A "done" surface diverges from the frame at review. |
| Two agents touch schema / shared chrome in one wave → migration or merge collision. | Medium | Rules 1–4: single schema owner per run, append-only, dependency waves isolated. | Two open diffs both edit `schema.ts`. |
| Apex domain (paid, external) slips → blocks SSO + passkeys. | Medium | M2-01 first task of M2; it is the one unavoidable paid line — surface the cost decision early. | M2 planning starts with no domain owned. |
| Managed Neon Auth never ships MFA and M2 also slips → 2FA/passkeys stay impossible. | Medium | M2 (self-host) is the real unblock, not waiting on Neon; treat Neon MFA as a bonus, not a plan. | Neon roadmap still says "coming soon" at M2 start. |
| Scope creep: M4 features pulled into M1 "for the demo." | High | M1 is hardening-only; anything not "demo needs it / real data broke it" is M4. | A wrangler/grid task appears in an M1 wave. |
| No error/observability → prod failures invisible. | Medium | M1-01/02/03 boundaries first; M3-14/15 dashboard + alerts. | A failing query shows Next's default error screen. |

---

## 4. What we are deliberately NOT building (and why)

These are documented so scope creep has a standing answer. Do **not** treat any of these as gaps.

- **Seeded user-generated content — permanently out.** Decided 26 Jul 2026. Seeds carry org-owned reference/catalog data only (edition, org group, camp categories, supplier catalog, org questionnaire templates). No seeded accounts, camps, memberships, registrations, responses, notifications or supplier notes — in **any** environment. The demo is performed live. Do not treat an empty directory or an empty registrations queue on a fresh database as a gap; it is the designed first-boot state, and the fix for "the page looks empty" is honest empty-state copy, never a seeded row.
- **Camp payments / treasuries / dues gateway — permanently out.** Locked 24 Jul 2026: the platform never holds funds and there are never camp registration fees. Money only ever relates to *future* logistics apps (M5-08), and only as status-tracking unless AB explicitly asks for checkout.
- **Placement / erf mapping / layout designer (CAD) — parked.** No structured geo data exists; the site map is a late PDF and changes yearly. The interim is staff-assigned ERF codes (M4-07). The layout designer is the single largest engineering item in either vision and must never block a release.
- **2FA / passkeys on *managed* Neon Auth — structurally impossible, not a bug.** Neon owns the server config and disallows custom Better Auth plugins. The honest "not available yet" states are correct. This unblocks only via M2 (self-host) or Neon shipping MFA.
- **Camper-identity DB (IDs/passports) — should likely NEVER be built.** It is the opposite of the self-serve bio model and a POPIA honeypot. Resist even if AB asks.
- **Third-party IdP / integrations console / public API / MCP (M5-01/02/04) — parked until real adoption.** Research is done (82 findings) but nothing in first-party auth depends on them.
- **Containers / water-ice-gas / attestations / PWA (M5-05/06/07) — deferred to the logistics phase.** They arrive together and share the offline-attestation problem space with Camp 404.
- **Collectives, camp-internal tooling, working-budget, compliance review, WhatsApp/SMS (M5-10) — candidate tracks, not committed.** Each graduates only on a validated-demand + fewer-forms test.
- **Intentionally-disabled surfaces that are correct-by-spec:** Placement tile, Budget tile, registration CTA gated to `theme_camp`, display-name edited in bio not inline, and honest empty states over invented data (the "registrations over time" chart until ≥2 months of history). These are honesty-over-fake-data choices, not defects. The wranglers coverage card was on this list until M4-01 landed on 29 Jul 2026; it now shows real counts.
- **The `M2` canvas-is-wrong design items** (e.g. Placement drawn as active) are won't-fix by decision, not backlog.

---

*Sources: the four project inventories (product / technical / quality / deferred), spot-verified against the live tree on 26 Jul 2026 — `ResponsiveDataTable` adopted in all four org tables, confirm-Dialog present in `account-actions.tsx`, supplier code chip still absent from `apps/suppliers/lib/session.ts`, CI still on `--no-frozen-lockfile`, `ACCOUNT_SWEEP_SECRET` still absent from `turbo.json` globalEnv, 13 migrations present. Key docs: `docs/auth-platform-spec.md`, `docs/deploy.md`, `docs/design-gap-register.md`, `docs/roadmap.md`, `docs/synthesis.md`.*

*Revision, 26 Jul 2026 (Ryan): two direction changes folded in. **(1) No seeded user-generated content** — `seed.ts` cut 1637 → 439 lines to org-owned reference/catalog data only; the M0 `authUserId` back-fill task deleted and replaced by the live path (M0-12); M0 renumbered 01–17 (the old `M0-11b` insertion artifact is gone); M1-09's seed-quality pass became a live demo-script rehearsal; `docs/deploy.md` rewritten to match. **(2) E2E must test everything, including auth** — the single M2-blocked auth-E2E task (old M3-16) expanded into a 16-task suite (M3-16 … M3-31) covering every journey across all three apps, with the auth flows that are testable on today's managed Neon Auth (M3-18) explicitly **unblocked** from M2 and only 2FA/passkey/change-email (M3-19) waiting on it; mail capture decided (M3-17) and CI wiring specified (M3-31). Fan-out gains wave 3e; barriers, adversarial passes and the risk register updated to match.*
