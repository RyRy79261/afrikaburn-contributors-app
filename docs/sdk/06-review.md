# SDK spec — review

Three independent reviews of `docs/sdk/01`–`05`, each run against the working tree.
They are kept verbatim, including where they disagree with the spec they reviewed and
with each other. **The pragmatism review recommends not building this yet** — read it
first.

---

# 1. Pragmatism review — should this be built, and when

## VERDICT

**Buildable: yes. The spec is unusually well-grounded — I spot-checked ~20 of its citations and they hold** (`orgCapabilityRefusal` at `packages/core/src/org-permissions.ts:621-655` with exactly the claimed 3-arg signature and rank-ceiling-first ordering; the free-camp law is literally `if (!registered && !viewerRole) continue;` at `apps/web/lib/groups-store.ts:187`; `packages/typescript-config/node.json` exists and is extended by nothing — all four packages use `base.json`; `commitlint.config.mjs` `SCOPES` is the 10 entries claimed; `packages/core/vitest.config.ts` does hold `privacy.ts` at 100/100/100/100; `ORG_DOMAINS` is in core not types). Nothing in it is fantasy.

**Worth building now: no. Not close.** Three facts decide it, and none of them are about the design's quality:

1. **The product is 11 days old and has one committer.** `git log`: 99 commits, first `2026-07-26`, last `2026-08-05`, `git shortlog -sne` shows one human (`RyRy79261 <ryanjnoble@gmail.com>`, 81 + 18 under two names). ~140k lines of TypeScript across 7 packages and 3 apps, all of it under a year-zero schema at migration `0028`.
2. **R1 is ~4 weeks away and it is the reason the product exists.** `docs/roadmap.md:39` — _"R1 — Registration season readiness (deadline: ~September 2026 — Form 1 opens Sept per the Theme Camps Guide)"_. Today is 2026-08-05. The spec's own estimate is **7–9 weeks for v0.1** (`shard-04:1431`), and v0.1 is nine read-only endpoints with no writes, no React package, no org tranche, no delegation tokens and no Integrations console. Building it means missing registration season.
3. **The org itself already parked this.** `docs/roadmap.md:109-116`, _"Platform-as-backend: public API + MCP server … **Explicitly parked until after the design pass lands.**"_ It is in the candidate track, below "Collectives — a questionable feature until real demand shows."

### On demand — the weakest part of the case, and the spec never tests it

The three personas in `shard-01 §1.2` do not survive contact with the repo.

- **Persona A (org internal tool)** already has a better option: it is a page in `apps/org`, with direct server-action access to the same 31 `requireOrgSession({capability, domain})` call sites. An npm package that holds a long-lived API key to reach data the console reaches over a cookie is strictly worse infrastructure for the same org.
- **Persona B (camp's own website)** is the nominal customer, and `shard-03 §3` disarms it: no publishable key, browser clients need a delegation token minted by the camp's own server — which is v0.2, deferred. _"If an integrator has no server, they have no browser client."_ Most theme camps do not run a server. The ones that do can server-render.
- **Persona C (third-party integrator)** has **zero named instances anywhere in the repo.** The only concrete consumer in any doc is Camp 404 (`docs/build-spec.md:5` → `github.com/ryry79261/camp-404`) — the maintainer's own other project, same GitHub handle as the sole committer. That consumer needs neither npm publication, nor an Apache relicence, nor an AfrikaBurn-owned npm org.
- **Suppliers are not integrators.** `apps/suppliers` already exists as a first-party portal (11,200 lines).

Meanwhile `docs/roadmap.md:97-107` — the "what we need from others" blocker table — shows AfrikaBurn has not yet supplied the 2027 registration opening date, the Google Form validation rules, or the fee/pricing decision. An organisation that has not returned a form-validation spec is not an organisation fielding integrator requests. And `shard-05 §6` puts npm-org creation _on AfrikaBurn_, i.e. behind that same table.

---

## EFFORT — my bottom-up, in engineer-days

The spec's 7–9 weeks (35–45 days) undercounts by roughly 1.5–2×, for three structural reasons: task 22 folds a legal decision, four CI mechanisms, an external dependency and the repo's first-ever published build into one "L"; **the SDK package itself is never sized in the plan** (tasks 1–22 are almost entirely backend/repo); and there is no allowance for the same engineer shipping R1 concurrently.

| #   | Workstream                                                                                                                                                                                                                                   | Spec        | Mine          | Why it moves                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Repo plumbing — commitlint scopes, `packages/scopes`, **three** tuple inversions (`roles.ts:150`, `:271`, `org-domains.ts:72`), CI matrix rows, `lint:pack` turbo task                                                                       | ~1.5d       | **2–3d**      | The inversions touch `@quagga/types` and `@quagga/core`, both under coverage floors, imported by everything                                                                      |
| W2  | Safety floor — `REGISTRATION_CONTACT_KEYS` promotion, `camp-visibility.ts` + 5 call sites, 9 zod response schemas, 2 emitter assertions, `loadOrgActor` extraction                                                                           | 9–13d       | **10–15d**    | Refactoring **live** authz paths on production with real medical notes and no staging (`AGENTS.md:10-17`)                                                                        |
| W3  | Key system — api-key plugin, migration **0029** (5 tables + enum + column), `authenticateApiRequest`, `/api-key/*` in 3 catch-alls, 9 invariant tests                                                                                        | 6–9d        | **8–12d**     | Every `@better-auth/api-key` fact is ⚠ unverified (`node_modules` confirmed absent). Migrations are append-only and run on deploy against production — a wrong 0029 is permanent |
| W4  | Manifest — `integration-manifest.ts`, `assertScopes`, actors×keys anti-drift matrix, integrator refusal arm, `/v1/capabilities` + ETag                                                                                                       | 8–14d       | **8–14d**     | Fairly sized. The anti-drift matrix is the genuinely valuable and genuinely expensive piece                                                                                      |
| W5  | The wire — handler wrapper, 3 rate-limit layers, 7 read endpoints, `api.` alias, oracle tests, observability                                                                                                                                 | 12–18d      | **12–20d**    | Includes the untestable timing-oracle budget (below)                                                                                                                             |
| W6  | Publishing — npm org (external dep), **FSL→Apache relicence decision**, LICENSE/NOTICE, SPDX on ~66 files, 4 CI licence mechanisms, changesets, 2 release workflows, provenance, publint/attw, first-ever `build` script in any `packages/*` | one "L"     | **8–14d**     | Systematically underestimated. `packages/core/package.json` is `main: ./src/index.ts` — no package in this repo has ever been built or published                                 |
| W7  | **The SDK package itself** — emitter, `Gate`/`Deny`, transport, 16-class error taxonomy, retries/deadlines/pagination/preflight, `ScopeContractError`, dual ESM/CJS, 4 subpaths                                                              | **unsized** | **8–14d**     | Cost is in the machinery, not the 9 endpoints                                                                                                                                    |
|     | **v0.1 total**                                                                                                                                                                                                                               | **35–45d**  | **56–92d**    | ≈ **11–18 weeks solo**                                                                                                                                                           |
| W8  | React package (v0.2) — provider, 9 hooks, 3 components, TanStack peer, RSC hydration, MSW subpath                                                                                                                                            | —           | **10–20d**    |                                                                                                                                                                                  |
|     | v0.2 rest (delegation+CORS, camp allowlist, idempotency, camp/self reads, **write tranche "XL"**, org reads)                                                                                                                                 | —           | **50–80d**    |                                                                                                                                                                                  |
|     | v1.0 (org writes, Integrations console, OpenAPI, deprecation)                                                                                                                                                                                | —           | **30–50d**    |                                                                                                                                                                                  |
|     | **Full spec**                                                                                                                                                                                                                                | —           | **~150–240d** | **7–11 months solo**                                                                                                                                                             |

---

## CUT LIST — speculative complexity that will not earn its keep

1. **The entire compile-time gate — `Gate<S, Need, T>`, `Deny<S>`, `ScopeTuple`, and the JSDoc-emitting generator** (`shard-01 §1.9`, `shard-02 §3`). This is the headline feature and it is the worst value in the document. It gates on a scope tuple the developer hand-writes, which duplicates what the manifest already knows; it is **ungated the moment `scopes` is omitted** — which is the documented 60-second quickstart (`shard-02 §1`); it "systematically under-reports and never over-reports" _by design_ (`shard-02 §3.3.3`), so a camp lead's key shows `Deny<…>` on methods that work; and any computed scope set is a compile error requiring the named escape hatch. Enormous type machinery whose only real failure mode caught is "you typed the tuple wrong." **The construction-time `ScopeContractError` diff gives ~90% of the same feedback, cannot be wrong, and is ~40 lines.**
2. **`@afrikaburn/react` in its entirety** (`shard-03`). Adds a `@tanstack/react-query` peer, 9 hooks, 3 components, an RSC hydration seam and an MSW testing subpath — for a persona that `shard-03 §3` itself says cannot work without the camp running a server. If they have a server, they render on it.
3. **Delegation tokens + the CORS story** (task 24, "L"). Same reasoning. Falls with #2.
4. **Timing-oracle equalisation** (`shard-04 §4.1.8` _"Budget the discard"_, task 20). On Vercel serverless with cold starts and the Neon HTTP driver, per-request variance is orders of magnitude larger than an early `return`. This is untestable to any meaningful standard and will burn days proving nothing. **Keep the cheap half** — identical 200-with-empty-permissions bytes for the three not-visible camp cases. Drop the timing budget to a comment.
5. **Four independent CI licence mechanisms + SPDX headers on ~66 existing files** (`shard-05 §5.3–5.7`). Two suffice: the eslint import wall and the tarball gate. `"dependencies": {}` plus an allowlisted `"files"` already covers most of it.
6. **`@afrikaburn/cli` name reservation** (`shard-05 §6` step 3) for a CLI that appears in no plan.
7. **Dual ESM/CJS.** New package, `engines: node >=20`, no legacy consumers. ESM-only halves the packaging surface and most `attw` failure modes.
8. **`apps/developers` docs site** (`shard-05` item 16). A whole Next app for zero integrators. A README plus the generated `docs/sdk/scopes.md` is the same information.
9. **The telemetry tier**: `onScopeObserved`, `X-AfrikaBurn-Accepted-Scopes` on every response, `onManifestStale`, the `unused` least-privilege notice. Individually clever, collectively a live scope-mapping system for a client base of one.
10. **`ab.camps` / `ab.artworks` / `ab.vehicles` sugar** (`shard-02 §5`). Three extra namespaces through the emitter to avoid typing `kind: "artwork"`.

### On OpenAPI: yes — but be precise about which 80%

Stronger than the question assumes. **Zod 4 is already everywhere** — `^4.4.3` in `packages/core`, `packages/types` and all three apps — and zod 4 ships `z.toJSONSchema()` natively _(high confidence, not verifiable in-session: `node_modules` is absent)_. Once W2's response schemas exist — and they must exist regardless, they are the PII stripper — an OpenAPI 3.1 document is close to free: schemas → JSON Schema → `components`, plus a hand-written path table for nine operations. `openapi-typescript` + `openapi-fetch` then gives an integrator typed paths, typed responses and a ~6 KB client that **the maintainer never maintains**.

The honest accounting: **OpenAPI eliminates W7 almost entirely and W6 completely. It does not touch W2–W5, which is where most of the cost lives anyway.** And it delivers 0% of the headline "key rights define usable features" requirement — _by that route_. But that requirement is cheap by another route: `GET /v1/capabilities` returning a scope array, a ~20-line `rights.has(scope)` helper, and honest `problem+json` 403s carrying `held_scopes` and the server's own refusal sentence. That is the DX promise. The `Deny<S>` compiler theatre is the last 20%, costs the most, and is the part that breaks.

---

## KEEP LIST — build these whether or not the SDK ever ships

Each is a first-party defect or debt today. The SDK spec's real service is having found them.

- **`packages/types/src/responses/*` — zod output schemas as the unconditional PII stripper.** `docs/auth-platform-spec.md:626-630` decision 2 committed to this and it was never built (spec reports `stripHardLocked`: zero hits; no `/api/me` — consistent with my reading, not independently grepped). Worth it for the three first-party apps alone. `shard-04 §4.9` is right that this will be offered up first in every deadline conversation and must not be.
- **Promote `REGISTRATION_CONTACT_KEYS` out of `apps/org/lib/queries.ts:952-960`.** Seven third-party contact columns (`s1ContactEmail`, `s1AltContactName/Phone/Email`, `s2LntLeadName/Phone/Email`) live on `registrations`, **outside `HARD_LOCKED_PRIVATE_FIELDS` entirely**, guarded today by a module-private `const` inside an app. Half a day.
- **Extract the free-camp predicate into `@quagga/core`.** Verified at `apps/web/lib/groups-store.ts:187`; the spec counts four further re-implementations. A product law re-typed five times is a latent bug independent of any API.
- **Fix `apps/web/lib/medical-access.ts:215` — `orgRankFromRole(actorOrgRole) ?? "org_staff"`.** I read this directly. It fabricates `org_staff` when the rank resolves null; `apps/org/lib/session.ts:234-236` treats the identical state as forbidden (_"a role that is not an org rank … resolves to null and is forbidden"_). Two apps, one input, two answers, **on a medical-notes access path, in production.** The ironic part: the comment sitting directly above that line explains at length why the rank must be real. This is a security item to fix this week; the SDK is irrelevant to it.
- **The `{ audience: "integrator" }` arm on `orgCapabilityRefusal`.** Verified the function and its rank-ceiling-first ordering. One arm on an existing generator, never a second copy table — the repo's own rule.
- **Correct the stale permission prose** (`shard-01 §1.13`, `org-permissions.ts:195-211`, `:239-262`, `:796-803`). Claimed to be wrong in the _permissive_ direction. Half a day _(I did not verify these three blocks line-by-line)_.
- **When endpoints do land: `/v1` path versioning, `application/problem+json`, opaque signed cursors, no `total`, `held_scopes` on 403s.** Cheap, correct, and the parts a consumer actually feels.

---

## RISK: the unmaintained second source of truth

This is the decisive risk, and the spec's mitigations address the wrong half.

The committed operation registry + `git diff --exit-code` (task 22) and the vocabulary drift gate (`shard-05 §5.5`) catch **mechanical** drift. They cannot catch **semantic** drift, and semantic drift is what will happen. `shard-04 §4.1.2` makes `/v1` append-only: you may not remove a response field, tighten a request type, or change an operation's required scope. **You would be freezing DTOs over a schema at migration 0028 that is still moving** — the two-form registration split landed six commits ago (`3a5adab feat(core,types): split the registration into Form 1 and Form 2`), and R1 explicitly plans previous-year duplication, ERF codes and wrangler boards on top of it.

Then compound it: **the relicence is irrevocable per version.** FSL→Apache-2.0 on `packages/sdk` (`shard-05 §5`) means every published version stays usable forever by anyone. If the maintainer's attention moves — a plausible outcome for a solo volunteer project serving a once-a-year festival — what survives is an Apache-2.0 client in strangers' `node_modules`, pointing at endpoints that drifted, under an npm scope AfrikaBurn was supposed to create but is behind the same blocker table that has not yet produced a registration date. That is not a maintenance burden; it is an artefact you cannot recall.

The spec's own strongest argument works against it here. `packages/core/src/org-permissions.ts:22-25` deleted `RANK_CAPABILITIES` because _"a second source of truth for permissions is how a console ends up refusing what it renders."_ The spec correctly refuses to ship the predicate kernel — then ships 49 scope strings, ~50 method signatures, a manifest schema and a full DTO set to the same `node_modules`, separated from the predicates by a version axis nobody controls. Smaller than the kernel. Same axis.

---

## THE ONE-WEEK v0.1 PLAN

Goal: **answer "does anyone want this?" for 5 days instead of 3 months, with zero irreversible decisions.**

Hard non-goals for the week — each is one-way: **no migration 0029**, **no npm publish**, **no Apache relicence**, **no `Deny<>` types**, **no React package**, **no API key of any kind**.

| Day   | Work                                                                                                                                                                                                                                                                                                                                                                                                                         | Reversible? |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **1** | Promote `REGISTRATION_CONTACT_KEYS` into `@quagga/core`, re-import in `queries.ts`. Extract `packages/core/src/camp-visibility.ts` and repoint every call site (`groups-store.ts:187` verified; the other four per spec). Tests to the existing coverage floors.                                                                                                                                                             | fully       |
| **2** | Delete the `?? "org_staff"` fail-open at `medical-access.ts:215`; extract one `loadOrgActor` both apps use. **This is a live security fix and ships regardless of the rest of the week.**                                                                                                                                                                                                                                    | fully       |
| **3** | `packages/types/src/responses/` — zod output schemas for the five DTOs first-party code already returns (`Edition`, `Category`, `GroupSummary`, `PublicProfile`, `SupplierSummary`). The recursive forbidden-field assertion importing `HARD_LOCKED_PRIVATE_FIELDS ∪ SAFETY_VISIBLE_FIELDS ∪ REGISTRATION_CONTACT_KEYS`, plus the `z.any`/`z.unknown`/`z.record`/`.passthrough` ban. Record the deliberately-red build hash. | fully       |
| **4** | Two read handlers in `apps/web` — `GET /api/v1/editions`, `GET /api/v1/groups` — **behind the existing session cookie, not a key**, both parsing through the day-3 schemas. Emit `docs/api/openapi.json` via `z.toJSONSchema()`, commit it, gate it with `git diff --exit-code`.                                                                                                                                             | fully       |
| **5** | `packages/api-client` — **private workspace package, FSL, never published**, types generated by `openapi-typescript` from day 4's document, a ~50-line fetch wrapper. Consume it from Camp 404 via a git/tarball dependency. Write down every friction point.                                                                                                                                                                | fully       |

**The gate, 30 days later:** if a second consumer exists and has asked for a third endpoint, build the key system (W3) and the manifest (W4) — in that order, still without publishing. If not, you spent 5 days and kept a live medical-access fix, the PII stripper `auth-platform-spec.md` said to build now, and a product law that stopped being re-typed in five places.

The parts of this spec worth its authorship are already in that week. The other three months are for users who do not exist yet — and `roadmap.md` was right the first time when it parked them.

---

# 2. Adversarial security and privacy review

# ADVERSARIAL REVIEW — `@afrikaburn/sdk` spec

Precheck passed (`/home/user/afrikaburn-contributors-app/pnpm-workspace.yaml`, 4 lines). All five shards read in full. Repo claims below were re-verified against source; where I could not verify I say so.

---

## CRITICAL

### C1 — Delegation minting has no rule constraining `subjectUserId`. Any integrator key is an impersonation primitive over every burner.

**Where:** shard-04 §4.3.12 "Delegation tokens (v0.2)"; supported by shard-03 §3 (the two-credential table) and §4.4 (`refreshDelegation`).

The mint request is specified as:

```
POST /v1/delegations   Authorization: Bearer ab_sk_live_…
{ "subjectUserId": "…", "scopes": [...], "audience": "…" }
```

Four rules follow — narrowing-only (`token.scopes ⊆ key.ceiling`), ≤10 min, audience-bound, never widened by refresh. **All four constrain the scopes and the lifetime. None constrains `subjectUserId`.** There is no stated requirement that the subject consent, that the subject be a member of an allowlisted camp, that the subject have any relationship to the integration, or that the integrator prove the browser it is minting for belongs to that subject. Shard-03 §3 calls the narrowing rule "a subset of the minting key's effective scopes" — but effective scopes are resolved for the **service** user (shard-04 §4.3.1, `effective(key,op) = resolveLiveSubject(key.serviceUserId) ∩ key.ceiling`), while the minted token then resolves `self:*` against a **different** user. The two halves of the intersection are computed over different identities.

**Attack:** an integrator holding `ab_sk_live_*` with `self:profile:read` in its ceiling loops over `users.id` (or resolves handles via the username→id lookup shard-04 §4.2 adds for `/v1/burners/{username}`), mints a 10-minute token per id, and reads `/v1/me/profile` as every burner on the platform. With `self:profile:write` it can also call `setPrivacyFlags` (shard-02 §6.4) on any burner — `enforcePrivacyFlags` (verified, `packages/core/src/privacy.ts:108-116`) only forces `ALWAYS_PRIVATE_FIELDS` false; `legalName`, `homeCity` and `contactEmail` are opt-in publics with no such protection, so the integrator flips a stranger's legal name public and then harvests it through the credential-free-ish `public:profiles:read` path. `self:registrations:write` lets it withdraw or reopen registrations for every camp that subject belongs to.

**Fix:** `subjectUserId` must be proven, not asserted. Three concrete requirements, all server-side: (1) the mint endpoint accepts a **subject-authorisation artifact**, not a bare id — either a first-party session cookie presented by the subject to a Quagga-hosted consent endpoint that returns a one-time delegation code, or a signed grant the burner created in `apps/web` naming the integration slug and scope set; (2) `self:*` scopes are refused on any delegation whose subject was not proven this way, with `insufficient_rights / reason: "not_delegated"` (the reason code already exists in the `Refusal` union, shard-02 §8.4 — it is currently unreachable); (3) an invariant test in the §4.3.11 table: `delegation-subject-requires-consent` — minting for a `users.id` with no consent row is a 403, and the test enumerates all six `self:*` scopes.

---

### C2 — `self:profile:read` is wired to `getBio`, which returns every hard-locked field, and the `SelfProfile` DTO is never defined anywhere in the spec.

**Where:** shard-04 §4.2, v0.2 table row `GET /v1/me/profile → apps/web/lib/bio-store.ts:52 getBio`; shard-02 §6.4 (`me(): Promise<SelfProfile>`) against §9 (DTOs) and §9.3 (fields no DTO carries).

Verified: `getBio(userId, editionId)` (`apps/web/lib/bio-store.ts:52`) does `db().select()` — **every column** of `burner_bios` — and its own doc-comment says it decrypts the ID document. That is `phone`, `onsiteContactName/Phone`, `offsiteContactName/Phone`, `medicalNotes`, and the decrypted SA ID / passport, i.e. all seven `HARD_LOCKED_PRIVATE_FIELDS` (`packages/core/src/privacy.ts:39-47`, verified) plus `SAFETY_VISIBLE_FIELDS` (`:57`).

Three parts of the spec now collide and none of them wins:

- shard-04 §4.2 "Never — no endpoint, at any scope, in any version" lists _"anything selecting `HARD_LOCKED_PRIVATE_FIELDS`"_ — and then §4.2's own v0.2 table adds an endpoint that does exactly that.
- shard-04 §4.5(a)'s forbidden-field walk imports `HARD_LOCKED_PRIVATE_FIELDS ∪ SAFETY_VISIBLE_FIELDS ∪ REGISTRATION_CONTACT_KEYS` and **fails the build** on any response schema containing those names. A `SelfProfile` schema that is actually useful to the burner is therefore unbuildable.
- shard-02 §9 defines `Edition`, `Category`, `GroupSummary`, `GroupDetail`, `RosterMember`, `PublicBio`, `PublicProfile`, `SupplierSummary`, `Bulletin`, `RegistrationSummary`, `ProjectRole`, `Notification`. **`SelfProfile` and `SelfProfilePatch` are referenced in §6.4 and defined nowhere.** The one DTO whose contents decide whether the platform's hardest privacy guarantee holds is the one DTO the spec forgot to write.

**Attack:** this resolves at implementation time under deadline, and the cheap resolution is an exemption — an allowlist entry, a `z.record()` for "the rest of the bio", or `.passthrough()` on the self shape — inside the exact mechanism §4.5 calls "the mechanism the whole safety argument rests on". Chain it with C1 and one integrator key reads every burner's SA ID, phone, emergency contacts and medical notes, with **no `bio.medical.view` audit row**, because §4.3.10 states "`bio.medical.view` is untouched and unreachable: no scope reaches medical notes" — an assumption that is false the moment `/v1/me/profile` exists over `getBio`.

**Fix:** write the DTO before the endpoint. `SelfProfile` is `PublicBio`'s field set plus the burner's own non-locked extras and **nothing from `ALWAYS_PRIVATE_FIELDS`** — the seven hard-locked fields and `medical` are absent from the type, exactly as §9.3 promises for every other DTO, and the `.parse()` strip is what makes that true. If a burner's own hard-locked data must ever be readable through the API, it is a separate, separately-consented, separately-audited endpoint that writes `bio.medical.view` per read (`packages/core/src/medical-access.ts`) — not a field on `self:profile:read`. Add `SelfProfile` to the §4.5 deliberately-red build set: a commit that adds `phone` to it must go red.

---

### C3 — every `self:*` endpoint is backed by a function that reads the session cookie, and the "handlers never read cookies" invariant is a source scan of the route file only.

**Where:** shard-04 §4.1.1 (the structural claim) vs §4.2's v0.2 backing-code column; §4.3.11 test `v1-handlers-never-read-cookies`.

§4.1.1's safety argument is: _"On a distinct host the answer is structural: `/api/v1/_`route handlers read only the`Authorization`header and never call`auth.api.getSession`. Cookie and key never co-arrive at the same decision."* It then concedes in its own block quote that `api.`is under the apex and **the cookie is sent** (verified:`AUTH_COOKIE_DOMAIN = ".quagga.ryanjnoble.dev"`, `packages/auth/src/env.ts:72`), and that the rule is "a handler-side rule, pinned by a source-scanning test".

That test (§4.3.11 row 6) scans "no file under `app/api/v1/**` references `getSession`, `cookies()` or `headers().get("cookie")`". **Every function §4.2 names as the backing code for the `self:` tranche reads the cookie one call deeper**, where the scan cannot see it (all verified):

| §4.2 endpoint                         | named backing function                                 | first line                                       |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `GET /v1/me/notifications`            | `apps/web/lib/notifications.ts:97 recentNotifications` | `getCurrentCampUser()` at `notifications.ts:101` |
| `POST /v1/me/notifications/{id}/read` | `notifications-actions.ts:21 markNotificationRead`     | `requireCampUser()` at `:25`                     |
| `GET /v1/me/bulletins/{id}`           | `bulletins.ts:25 getBulletinForCurrentUser`            | `getCurrentCampUser()` at `:29`                  |
| `GET /v1/me/bulletins`                | `bulletins.ts:64 getPinnedBulletinsForCurrentUser`     | `getCurrentCampUser()` at `:68`                  |

`getCurrentCampUser` → `getAuthenticatedUser` → the cookie (`apps/web/lib/session.ts:183-192`). `requireCampUser` additionally calls `redirect("/auth/sign-in")` — a thrown Next control-flow signal inside an API route. And `ensureCampUser` runs `bootstrapGod` on every call (`session.ts:62-103`), so a cookie-authenticated identity is _created and possibly elevated_ by a request the wrapper believes is key-authenticated.

**Attack:** a burner signed into `app.quagga.ryanjnoble.dev` visits an integrator's page (or is CSRF'd to `api.quagga.ryanjnoble.dev/v1/me/…`); the browser attaches the apex session cookie automatically. The handler resolves scope against the **key's** service subject and the data against the **cookie's** subject. `self:notifications:write` on a key that legitimately holds it now marks an arbitrary signed-in burner's inbox read; `self:bulletins:read` returns that burner's received org broadcasts. This is precisely the "which credential wins" failure §4.1.1 claims the host split makes impossible — the split moved the ambiguity from the handler to the store, and the test only looks at the handler.

**Fix:** (a) every `self:` store function reachable from `/v1` must take an explicit `userId` parameter — no `getCurrentCampUser()` anywhere below a `/v1` handler; the four functions above get `…ForUser(userId, …)` siblings and the cookie-reading ones become thin wrappers used only by the app. (b) Change the invariant test from a route-file scan to a **transitive import-graph scan**: no module reachable from `app/api/v1/**` may reference `getCurrentCampUser`, `requireCampUser`, `cookies()`, `getSession` or `redirect`. The idiom already exists — `apps/org/lib/__tests__/org-rank-enforcement.test.ts` reads ~15 source files. (c) Strip the `Cookie` header at the `/v1` wrapper's entry as defence in depth, so a store that regresses gets `null` rather than an identity.

---

## HIGH

### H1 — `manifest.routes` is unvalidated server-supplied data that the SDK uses as the destination for the API key. It is a credential-exfiltration primitive.

**Where:** shard-04 §4.1.1 (`manifest.routes` as data) and §4.4; shard-02 §4.3 (`baseUrl` is "origin of the capabilities endpoint" only); shard-03 §9.2 (`assertManifest`).

The design is explicit: _"The single well-known entry point an integrator configures is the capabilities URL. Everything else the SDK learns from the manifest."_ The SDK therefore sends `Authorization: Bearer ab_sk_live_<64>` to whatever origins appear in `routes[*].base`. The only validation specified anywhere is shard-03 §9.2's `assertManifest`, which checks `manifestVersion !== 1` and nothing else — no origin allowlist, no same-registrable-domain rule, no scheme check, no signature over the manifest.

**Attack:** three realistic paths. (1) A developer sets `baseUrl` to a typo-squatted or staging host once; the returned manifest names attacker origins for `groups` and `org`, and every subsequent call ships the live key. (2) shard-02 §4.3 and shard-03 §4.2 both accept a pre-fetched `manifest` object from the caller — an RSC hydration seam and a plain prop — so anything that can influence that object (a poisoned cache, a compromised CDN'd fixture, `@afrikaburn/react/testing`'s `buildManifest` left in a prod path) redirects the credential without touching the key itself. (3) A single compromised or misconfigured response from `/v1/capabilities` — the one endpoint with a 300 s client TTL and an ETag — turns into 300 s of key exfiltration across every process holding that manifest.

There is no rotation defence: §4.3.7 says revocation is instant on the next request, but the attacker has the plaintext key, and grace-window rotation (§4.3.6) keeps the old key live for 7 days.

**Fix:** treat `routes` as a _selector_, not a URL source. Ship a compiled-in origin allowlist in `packages/sdk/src/generated/` (emitted alongside `vocabulary.ts` and covered by the same drift gate); `routes[ns].base` must match one entry exactly or the client throws `ProtocolError` at construction. Failing that, minimum bar: require `https:`, require the same registrable domain as the configured `baseUrl`, reject userinfo/port/path traversal, and never attach the `Authorization` header to an origin that was not in the config. Add it to `assertManifest`, which currently validates one integer.

### H2 — the `/api-key/*` block is a substring match on the raw pathname, and the resolution flow has no branch for a key with no integration row.

**Where:** shard-04 §4.3.3 (the `blocked()` helper — the spec's own "single highest-value hardening decision"); shard-01 §1.8 flow node C; §4.3.11 test `api-key-http-endpoints-blocked`.

```ts
function blocked(request: Request): boolean {
  return new URL(request.url).pathname.includes("/api-key/");
}
```

`URL.pathname` does **not** percent-decode. Any encoded character in the segment — `/api/auth/api%2Dkey/create`, `/api/auth/api-key%2Fcreate`, a doubled slash, a `.` segment — evades this string test while a router that normalises or decodes still dispatches. The paired invariant test POSTs the one literal path and asserts 404, so it certifies the exact case that already works. (I could not verify better-auth 1.6.25's router normalisation — `node_modules/` is absent, the same caveat §4.3.11 carries — but a raw-string blocklist in front of a third-party router is the wrong shape regardless of which way that resolves.)

Compounding it: `apikey` rows have deliberately **no FK** to `integration_keys` (§4.3.2 item 4, so audit rows outlive plugin deletes), and the §1.8 flowchart tests only `integrations.status === 'active'`. There is no specified behaviour for an `apikey` row with **no** `integration_keys` row and therefore no integration and no `integration_scopes` — i.e. exactly what a self-minted key is. The `ApiCaller` type (§4.3.8) has non-optional `integrationId`/`ceiling`, which suggests it fails, but nothing states it, no test covers it, and the codebase already contains the dangerous idiom that empty means unrestricted: shard-02 §3.1/§4.2's `ScopeTuple` default collapses `S[number]` to the whole `Scope` union, so "no scopes declared" is the documented full-unlock at the type layer.

**Fix:** (a) block on a normalised, decoded path _and_ by asserting the plugin's endpoints are not in `auth.api`'s route table at all — a positive allowlist of the auth paths the app serves beats a denylist of the ones it doesn't. (b) Extend the invariant test to a table of encoded/normalised variants (`api%2Dkey`, `api-key%2F`, `//api-key/`, `/api/auth/./api-key/create`) plus one that asserts the block is enforced for every HTTP method the handler exports. (c) Add an explicit flow node and test: _a key whose `apikey.id` has no `integration_keys` row is a 401, and an empty `ceiling` authorises nothing_ — `assertScopes` must never treat `ceiling.length === 0` as a wildcard.

### H3 — `PublicProfile.campHistory` ships a free camp's name **and slug** to an unauthenticated stranger, in a v0.1 blocking endpoint.

**Where:** shard-02 §9.1 (`PublicProfile.campHistory: readonly CampHistoryDisplay[]`, annotated only _"Linked entries render as camp links only when registered"_); shard-04 §4.2 v0.1 row `GET /v1/burners/{username}` → `groups-store.ts:626 getPublicBurnerProfile`.

Verified in `apps/web/lib/groups-store.ts`: `CampHistoryDisplay` is `{kind, label, slug, registered, event, years}` (`:519-529`), and the resolver at `:576-585` populates `label: g.name, slug: g.slug` for **every** linked entry whose group still exists, setting `registered` from a separate lookup. The undiscoverability enforcement for this field is **presentational**: `apps/web/components/profile-public/profile-camps.tsx:10-15` says the entry's `registered` flag "is the only thing that turns it into a discoverable link" — the component decides not to link it.

The SDK deletes that component. It ships the raw record to a third party. A `registered: false` entry carrying a resolvable `slug` is a direct answer to "does this free camp exist", which the rest of the spec spends `/v1/capabilities/camps`' identical-bytes rule, the identical-404 rule and the no-`total` rule protecting. It also makes `viewerId = null, always` (§4.2) irrelevant on this path — the leak is not through the directory query at all.

**Fix:** the response schema for `PublicProfile.campHistory` omits `slug` and `label` whenever `registered === false`, and this belongs in the extracted `campIsVisibleTo` predicate (§4.5's new `packages/core/src/camp-visibility.ts`), applied server-side — not left to the DTO's prose. Add it as the fifth call site in blocking task 5, and add an oracle test alongside §4.8 task 20's: a burner whose only camp is unregistered yields a `campHistory` byte-identical to a burner with no camp history.

### H4 — the React cache is keyed on `manifest.key.id`, but delegation tokens are per-subject; a multi-tenant integrator cross-serves data between burners.

**Where:** shard-03 §10.1, which claims the opposite in so many words: _"`keyId` is in the key so two credentials never share a cache entry — an integrator running a multi-tenant server with per-tenant delegation tokens must not serve tenant A's roster to tenant B."_

Query keys are `["afrikaburn", keyId, namespace, method, argsHash]` with `keyId = manifest.key.id`. Under shard-04 §4.3.12, every delegation minted from one API key — for _different_ `subjectUserId`s — descends from the same `apikey.id`. The narrowed manifest handed to `<AfrikaBurnProvider>` (shard-03 §4.2 `DelegationGrant.manifest`) carries the same `key.id`. So the discriminator is constant across exactly the axis the section says it separates. `self:*` reads (`/v1/me/profile`, `/v1/me/notifications`, `/v1/me/registrations`) take **no arguments** — `argsHash` is constant too — so `["afrikaburn", key_01J…, "burners", "me", ∅]` is one cache entry shared by every subject rendered by that server.

**Fix:** key on the credential's **subject**, not the credential's key: add `subject: {id}` to the delegated manifest (it is already in `Manifest.subject` for the service case) and make the query key `["afrikaburn", keyId, subjectId, ns, method, argsHash]`. Add the §12.5 test: two providers with tokens for different subjects and a shared `QueryClient` must not share a `me` entry.

---

## MEDIUM

### M1 — the `/v1` wrapper has no step that computes `loadRegistrationRow`'s `personal` argument; the engineer PII carve-out is bypassed by construction because the API deleted the capability it acts on.

**Where:** shard-02 §6.11 (`read × registrations` — _"no existing guard … a bare console-session page guard plus `seesPersonalInformation`"_); shard-04 §4.2 org tranche; §4.5; §4.8 task 17's wrapper chain "auth → scope gate → rate limit → handler → zod parse → headers".

Verified: `apps/org/lib/queries.ts:975-1000` — `loadRegistrationRow(id, personal)` takes the authorisation as a boolean and, when false, excludes the seven contact columns **from the SQL select list** via `getTableColumns`, with the deliberate property that a column added later is included automatically. `personal` is derived in the console from `seesPersonalInformation(actor, "registrations")`, which is where `ENGINEER_RANK_CARVE_OUTS = ["personal_information","delete"]` (`packages/core/src/org-permissions.ts:300-303`, verified) actually bites.

The SDK vocabulary has no `personal_information` scope (§1.5 rule 1), so a `/v1/org/registrations` handler has **nothing to derive `personal` from**, and the wrapper chain contains no step that does. The spec's replacement control is the zod output schema (§4.5). That is a strictly weaker mechanism than the one it replaces: it moves the exclusion from the query plan to serialisation, so the contact columns transit application memory, the `.parse()` input, any exception path, and — see M2 — the idempotency response store. And it means the engineer carve-out, which the console enforces before any role is consulted, has no representation on the API path at all.

**Fix:** the handler passes `personal: false` as a literal, and an invariant test in the §4.3.11 table asserts it — source-scan every `/v1/org/**` call of `loadRegistrationRow` for a `false` literal, the same idiom `org-rank-enforcement.test.ts` uses. Better: give `loadRegistrationRow` a third caller-kind argument that has no `true` value reachable from `/v1`. Keep the zod strip as the second wall, not the first.

### M2 — idempotency replay returns a stored response with no re-authorisation, at an unspecified point in the wrapper chain, from a durable PII store.

**Where:** shard-04 §4.1.10; shard-02 §7.3; §4.8 task 17.

The store is `(key, api_key_id, request_hash, status, response_body, created_at)`, 24 h. §4.8's wrapper chain — "auth → scope gate → rate limit → handler → zod parse → headers" — does not contain idempotency at all, so the order is undefined. If the lookup short-circuits before the scope gate (the natural implementation, since the point is to skip the handler), then for 24 hours after a successful write a key whose scopes were **narrowed or revoked** still receives the full prior response body on replay. §4.3.7 promises "revoking a key takes effect on the next request", which is stronger than what this table permits. Separately, `response_body` is a 24-hour durable copy of response payloads with no stated encryption, no stated forbidden-key scrubbing (§4.7 applies that walk to the _logger_ only), and no stated deletion on key revocation or on a POPIA erasure request — the erasure path (`/api/account/deletion-sweep`) has no idea this table exists.

**Fix:** pin the order in §4.8 task 17 — auth → scope gate → **then** idempotency lookup, so a replay is authorised exactly as the original was, and a narrowed key gets a 403 rather than a cached 200. Delete the integration's rows on `apikey.enabled = false` and on `integrations.status = 'suspended'`. Store a hash + status + `Location`, not the body, wherever the operation permits; where the body must be stored, run the §4.5 forbidden-key walk over it before persisting and add the table to the erasure sweep.

### M3 — the camp allowlist, which is the only thing stopping a camp-scoped key from reaching other camps, is a deferred migration behind an optional function parameter with no invariant test.

**Where:** shard-01 §1.5 rule 3 and the §1.8 flow node _"groupId ∈ key camp allowlist?"_; shard-04 §4.3.2 (_"Deferred to a later migration on purpose: the per-key camp allowlist (`integration_key_camps`) lands with the v0.2 camp tranche"_), §4.3.8 (`loadCampPermissions(db, userId, groupIds?)`), §4.4 assembly step 4, §4.3.11 (nine tests — none covers the allowlist).

`camp:` scopes carry no group id by design; reach is _entirely_ the mint-time allowlist. Yet the parameter that expresses it is optional, and the two invariant tests that do exist for the camp tier (`service-user-is-never-god`, `service-user-holds-no-camp-backstop`) constrain the subject's _rank_, not its reach. Verified: `getMemberPermissions` (`apps/web/lib/roles-store.ts:869-900`) resolves the union of every role held on any camp where the user has a membership — so with `groupIds` omitted, a key resolves camp permissions on **every camp its service user is a member of**, and camp membership is grantable by any camp lead anywhere without org involvement (the only brake is `consentStatus === "accepted"` at `:895`, which is a state a service identity has no UI to reach — and no test asserts it cannot).

**Fix:** make `groupIds` **required** on `loadCampPermissions` (a required empty array is a deny; an omitted argument is a fail-open), land `integration_key_camps` in migration 0029 rather than 0030 even if unused at v0.1, and add two rows to §4.3.11: `camp-scope-requires-allowlist` (a camp scope on a groupId outside the allowlist is a 404 even when the subject is a member) and `service-user-cannot-accept-a-role` (`memberRoleAssignments.consentStatus` never becomes `accepted` for `users.kind = 'service'`).

### M4 — delegation `audience` is sold as a security control and is unenforceable under the spec's own CORS rule.

**Where:** shard-04 §4.3.12 rule 3 vs §4.1.9; shard-03 §3 (the credential table's "audience-bound" row, and §4.2's `DelegationGrant.audience`).

§4.3.12 rule 3: _"Audience-bound. `aud` pinned to a registered origin; the CORS allowlist and the token audience are the same list."_ §4.1.9, two sections earlier: _"`Origin` is not an authorisation input anywhere. It is a browser courtesy; `curl -H 'Origin: …'` defeats it, which is why decision 17 killed the publishable-key design."_ Both cannot be true. If `Origin` is never an authorisation input, the server has nothing to check `aud` against, and `audience` is a decorative field on a plain bearer token. Shard-03 §3's table then rests the entire browser story on "≤ 10 minutes, audience-bound", where only the first half is real.

**Fix:** say so plainly and stop claiming the second half. The honest statement is: _a delegation token is a bearer credential; anyone who obtains it holds it for up to 10 minutes with its exact scopes and subject; `audience` scopes the CORS response, not the authorisation._ Then earn some of it back with mechanisms that survive `curl`: bind the token to the subject-consent artifact from C1, keep the TTL at the low end for `self:*` (60–120 s, not 600), and make refresh require the minting key so a stolen token cannot be extended.

### M5 — the 409 unique-name conflict is a free-camp existence oracle that the oracle rules do not cover.

**Where:** shard-02 §8.2, code `conflict` — _"Unique-name clash (`groups` is unique on `(kind, name_normalized)`)"_ — with `create` in §6.2 (`ab.camps/artworks/vehicles`, v0.2); shard-04 §4.1.8, whose three-row table covers reads only.

Every oracle control in the spec (identical 404s, 200-with-empty probes, no `total`, opaque cursors, no free-text search, search applied after visibility — the last verified at `groups-store.ts:186-187`) is a read-path control. A write that returns 409 on `name_normalized` collision answers "does a camp with this name exist" for **free camps too**, since uniqueness is global and does not consult registration status. With `limit`-free create attempts against the §4.6 write budget (60/60 s), that is a name-dictionary attack on exactly the set the platform hides.

**Fix:** decide it before the v0.2 write tranche. Either creation via `/v1` is refused entirely for integrator keys (defensible — `createCamp` is a participant action), or the collision response is indistinguishable from a validation refusal and carries no signal about _why_ (`invalid_request` with a generic "that name is not available", identical bytes and timing for taken-by-registered, taken-by-free, and reserved). Add it to §4.8 task 20's oracle test set, which currently tests only the three camp-probe cases.

### M6 — cursors: shard-02 promises key binding that shard-04's cursor payload cannot provide, and the signature reuses `BETTER_AUTH_SECRET` with no domain separation.

**Where:** shard-02 §7.1 (_"A cursor is valid for 15 minutes and is bound to the issuing key; a cursor presented by a different key is `ValidationError`, not a leak"_) vs shard-04 §4.1.11 (_"base64url JSON `{k: <sort key>, id: <tiebreak uuid>}` signed with `BETTER_AUTH_SECRET` (HMAC-SHA256, truncated to 16 bytes)"_).

The payload has no key id and no issued-at, so neither the binding nor the 15-minute expiry shard-02 advertises is implementable from it. Impact is bounded — each page re-runs the visibility filter, so a transplanted cursor mostly just resumes a scan — but a documented control that does not exist is worse than none, and reviewers will stop checking. Separately, `BETTER_AUTH_SECRET` is the session-signing secret; using it raw for a second purpose over attacker-supplied JSON is a needless cross-protocol surface.

**Fix:** put `k`, `id`, `kid` (the `apikey.id`) and `iat` in the payload, verify all four, and derive the signing key with an HKDF label (`"quagga/v1/cursor"`) rather than using `BETTER_AUTH_SECRET` directly.

### M7 — successful reads are unaudited, so a working key exfiltrating within budget is invisible, and the alert set only watches refusals.

**Where:** shard-04 §4.3.10 (_"Successful reads are not audited"_; read volume observable only from `apikey.requestCount` / `lastRequest`) and §4.7's alert table.

The four alert conditions are: refusal rate >20 % for one key, any `rank_ceiling` refusal, any successful call by a System-manager subject, and kernel skew. Every one of them fires on _failure_ or _misconfiguration_. A key behaving exactly as issued — 300 requests/minute of `public:profiles:read` and `camp:view_member_details`, 432,000 profiles a day, all authorised — trips nothing, and `audit_events` has no row to answer a burner's POPIA subject-access request ("who read my profile?") or to scope a breach after a key leaks. §4.3.10's justification ("one row per directory listing would bury the log that `getMedicalAccessLog` depends on") is sound about _volume_ but the conclusion is too broad: it drops person-identifying reads along with the anonymous ones.

**Fix:** audit reads that **name a person** — `/v1/burners/{username}`, `/v1/groups/{slug}/members`, `/v1/org/accounts/*` — at a coarse grain (one row per key per subject per hour, upsert on a unique index, `meta: {count}`), leaving directory and edition listings unaudited. Add two alerts that watch success: a per-key distinct-subject count over 24 h, and any key reading more distinct burners in an hour than its integration has ever read in a day.

### M8 — `org.accounts.search` / `roster` is the burners-list endpoint the spec spent two sections forbidding, with no existing guard and no DTO.

**Where:** shard-02 §6.11 (`org.accounts` → `search`, `roster` under `org:read:accounts`) and the same section's own table: _"`read` × `accounts` — **no** existing guard (`queries.ts:393,780`)"_; against shard-04 §4.1.8 (_"There is deliberately **no** `GET /v1/burners` list endpoint at any scope"_) and shard-02 §6.4 (_"There is no `ab.burners.list()` and there never will be"_).

Both refusals rest on the same reasoning: a list projection over Burn identities is a bulk-enumeration endpoint. `org.accounts.search` is that endpoint wearing an org scope — and unlike the camp and burner surfaces it has **no existing `requireOrgSession({capability, domain})` call site** to inherit, meaning the guard is new code written for the API, and no response DTO is specified in §9 to bound what it returns.

**Fix:** either cut `org.accounts` from the SDK's org tranche, or specify it as narrowly as the refusals it contradicts: exact-handle lookup only (no substring, no prefix, no wildcard), no pagination, a hard per-key daily distinct-subject cap, an explicit DTO in §9 limited to `{userId, displayName}` via `publicMemberName`, mandatory audit under M7, and the new `requireOrgSession({capability:"read", domain:"accounts"})` call added to the existing query path (`queries.ts:393,780`) rather than re-derived in the handler.

---

## LOW

- **L1 — `X-AfrikaBurn-Accepted-Scopes` on existence-privileged 404s.** §4.1.5 puts it on _every_ response; §4.1.8 strips `required_scopes`/`held_scopes`/`remediation_url` from a 404 but says nothing about this header. A 404 carrying an `Accepted-Scopes` value proves the request reached a scope-enforcing operation, distinguishing "privileged resource" from "no such route". Fix: suppress it on any `mode: "notFound"` response, and add it to §4.8 task 20's byte-identity assertion.
- **L2 — orphaned ceilings.** `integration_scopes.api_key_id` is `text`, `notNull`, with **no** FK (§4.3.2 item 5) and the plugin hard-deletes `apikey` rows on exhaustion (§4.6). Scope rows therefore outlive their key with no cleanup path specified; if a plugin-generated id is ever reused, a new key inherits a dead key's ceiling. Fix: delete the scope rows in the same statement that revokes a key, and add the orphan count to the §4.7 Integrations probe.
- **L3 — `assertScopeVocabulary()` is not called on every write path it claims.** §4.3.2 item 5 says validation happens "on every insert path", but the rotation procedure (§4.3.6 step 3) copies scope rows directly, which is an insert path that bypasses it. Low impact today; it means the nightly reconciliation job is the only thing catching a scope retired between mint and rotation.
- **L4 — the spec's own §4.10 item 4 overstates the `medical-access.ts:215` fail-open.** The `orgRankFromRole(actorOrgRole) ?? "org_staff"` fallback is real (verified), but the in-file comment at `apps/web/lib/medical-access.ts:205-215` argues it deliberately and notes `god` is decided inside the predicate. The extraction in blocking task 8 is still right; the justification should be "one actor builder, not two" rather than "this is live-exploitable", or someone will de-prioritise it when they read the comment.

---

**One structural note, not a numbered finding.** Six of the ten most serious items above (C1, C2, C3, H3, M1, M3) share a shape: the spec is rigorous about the _public read_ tranche it ships first, and thin about the `self:` and `org:` tranches it defers. The deferred tranches inherit the v0.1 wrapper, the v0.1 tests and the v0.1 assumptions — including "no scope reaches medical notes" and "cookie and key never co-arrive", both of which stop being true in v0.2. The nine invariant tests in §4.3.11 are all v0.1 tests. Whatever else changes, the §4.3.11 table needs its v0.2 rows written **now**, in the same document that defers the endpoints, rather than by whoever implements them eighteen months later.

---

# 3. Completeness review — gaps and cross-shard contradictions

TOOL-LAYER PRECHECK PASSED (`/home/user/afrikaburn-contributors-app/pnpm-workspace.yaml` read: 4 lines, `packages:` / `apps/*` / `packages/*` / `e2e`).

All five shards read in full. Line citations below are `shard-NN:line`. Every claim is about shard content, not repo content; where I say a shard's repo citation is uncorroborated I say so rather than asserting.

---

# A. CROSS-SHARD CONTRADICTIONS (highest first)

### A1. The scope count is stated three incompatible ways, and shard 5's arithmetic silently re-admits `personal_information`

- **Shard 1** (`shard-01:253-259`): 32 org (**four** capabilities × 8 domains) + 5 camp + 6 self + 6 public = 49.
- **Shard 2** (`shard-02:97-115`) agrees, and explicitly narrows: `SdkOrgCapability = "create"|"read"|"update"|"delete"`, flagged as a deliberate shadowing of the repo's five-member `OrgCapabilityKey` (`shard-02:93-98`).
- **Shard 4** (`shard-04:289-292`) computes "the org slice of that vocabulary is 8 domains × **5** capabilities = 40 cells".
- **Shard 5** (`shard-05:60-61`): "`5 × 8 = 40` org scopes + 5 camp permissions = 45, and `SELF_SCOPES` + `PUBLIC_SCOPES` … make up the remaining **4** of the 49."

Shard 5's number only reaches 49 by including all forty org cells (i.e. `org:personal_information:*`, the one thing shards 1, 2 and 4 agree is never issuable) and by shrinking self+public from twelve scopes to four. This is not cosmetic: **shard 5's generator emits `ORG_CAPABILITIES` verbatim** (`shard-05:638-639`, `shard-05:701-703`) from `@quagga/scopes`, which shard 5 §1 requires to re-export the repo's five-member tuple. So `OrgScope = \`org:${OrgCapability}:${OrgDomain}\``computed over the generated vocabulary produces 40 members including PII — the emitted`Scope`union would contain strings shards 1 and 2 forbid from existing.
**Owner: shard 1** (it declares itself authoritative on scope strings,`shard-01:5-7`), with a mandatory correction to shard 5's generator.
**Fix sketch:** `@quagga/scopes`must export two distinct tuples —`ORG_CAPABILITIES`(5, the repo's, for`@quagga/types`/`@quagga/core`to consume in the inversion) and`SDK_ORG_CAPABILITIES`(4, the narrowing) — and`emit-sdk-vocabulary.mts`must emit only the latter. Add a unit test in`packages/scopes`asserting`SDK_ORG_CAPABILITIES`is`ORG_CAPABILITIES`minus exactly`personal_information`, and a test asserting `Scope` has exactly N members where N is a committed literal, so any of the four shards' arithmetic drifting again is a red build. Then reconcile the self/public counts against A2 and publish one canonical table in shard 1 §1.5 that shards 2, 4 and 5 cite rather than restate.

### A2. `public:bulletins:read` exists in shards 1/2/3 and is deleted by shard 4 — and shard 2 ships a whole namespace on it

Shard 1 (`shard-01:246-248`) and shard 2 (`shard-02:111-113`) both list `public:bulletins:read` in `PublicScope`. Shard 2 §6.5 (`shard-02:586-587`) specifies `ab.bulletins.list` and `ab.bulletins.get` gated on it. Shard 4 (`shard-04:317-328`, and open item 6 at `:1515-1523`) deletes the scope outright with a specific, well-grounded argument (bulletins carry an `AudienceSpec`, both store functions open with `getCurrentCampUser()`, a `viewerId = null` caller is entitled to nothing) and replaces it with `self:bulletins:read`, delegation-token only. Shard 4 itself flags the reconciliation as outstanding (`shard-04:294-297`).
**Owner: shard 4's argument wins; shard 1 must adopt it, shard 2 must delete the namespace.** Shard 1's own precedence rule does not settle this, because shard 1 wrote its list without the `bulletins.ts:9-14` evidence.
**Fix sketch:** delete `public:bulletins:read` from `PublicScope`, add `self:bulletins:read` to `SelfScope` (self becomes 7, public 5; total holds at 49 if A1's other numbers are right). Shard 2 moves `ab.bulletins` out of the v0.1 public tier into a `ab.me.bulletins` (or `ab.notifications`-adjacent) v0.2 surface, delegation-token only, with a one-line note that a genuinely public announcements feed is a product decision requiring a new audience kind, not an API feature.

### A3. `@quagga/scopes` is FSL in two shards and Apache-2.0-at-birth in the shard whose entire legal argument depends on Apache

Shard 1 (`shard-01:239`): "`// @quagga/scopes — PRIVATE, FSL`". Shard 4 task 2 (`shard-04:1389`): "`packages/scopes` (private, **FSL**, zero deps)". Shard 5 (`shard-05:21-22`, `:646-656`): "src/** files are **Apache-2.0 AT BIRTH**", `"license": "Apache-2.0"` in its package.json, and the codegen boundary is legal *only because* "its OUTPUT is Apache-2.0 because its INPUT is" (`shard-05:670-673`).
Under shard 1/4's labelling, `emit-sdk-vocabulary.mts` copying scopes source into `packages/sdk/src/generated` is a relicensing of FSL code into an Apache artifact, and shard 5's own `licence-boundary.mjs` check 3 (`shard-05:860-872`) would fail on the FSL SPDX marker it would carry.
**Owner: shard 5** (it owns licensing), but shards 1 and 4 must be corrected in the same PR.
**Fix sketch:** ratify Apache-2.0-at-birth for `packages/scopes/src/**`, add one sentence to shard 1 §1.5 and shard 4 task 2 saying so and why (`private`= "npm must refuse to publish";`license`= "these are the terms on the source" — the two answer different questions,`shard-05:646-650`). Note the second-order consequence nobody states: `@quagga/types`and`@quagga/core` will then carry FSL SPDX headers while importing an Apache workspace, which is legal in that direction only, so the dependency edge direction in A4 becomes load-bearing for licensing, not just for zod.

### A4. The `@quagga/types` ↔ `@quagga/scopes` dependency edge points in opposite directions in shards 2 and 5

Shard 2 (`shard-02:85-91`): the SDK vocabulary is "generated AT BUILD TIME FROM `@quagga/types`, **which is and stays the source of truth** … if [a scopes package] is introduced it must **DERIVE from `@quagga/types`, never the reverse**". Shard 5 (`shard-05:37-58`, `:1624`): `@quagga/types` → `@quagga/scopes` and `@quagga/core` → `@quagga/scopes`; `roles.ts:150` inverts to `z.enum(ORG_CAPABILITY_KEYS)`; **three** tuples move, and leaving a duplicate behind is "a product law, not a preference". Shard 1 (`shard-01:234-237`) and shard 4 (`shard-04:1389`) side with shard 5.
Shard 5's direction is the only one that satisfies both constraints simultaneously (zod-free vocabulary, and FSL-consumes-Apache rather than the reverse). Shard 2's sentence is a direct negation of the plan three other shards are built on.
**Owner: shard 2** — delete the "never the reverse" clause.
**Fix sketch:** replace shard 2 §2's comment block with: `@quagga/scopes` is the authoring home; `@quagga/types` and `@quagga/core` re-export from it; the SDK vendors it by codegen with **no** dependency edge in either direction. Add the missing consequence shard 5 identifies but shard 2 omits: `ORG_DOMAINS` lives in `packages/core/src/org-domains.ts`, not in types, so **two** packages gain a `@quagga/scopes` dependency, not one.

### A5. `createServerClient` is synchronous in shards 1 and 3 and returns a `Promise` in shard 2 — and shard 3's canonical wiring does not compile under shard 2

Shard 2 (`shard-02:36`, `:247-249`, `:64-65`): `createServerClient` returns `Promise<AfrikaBurn<S[number]>>`, "async because it fetches the capability manifest and reconciles it … before returning". Shard 1 (`shard-01:166-170`, `:529-531`): synchronous, `declare function createServerClient<…>(cfg): AfrikaBurn<S[number]>`, with a typed `const ab: AfrikaBurn<…> = createServerClient({…})`. Shard 3 uses the synchronous form in **every** example — module-scope `const ab = createServerClient({…})` at `shard-03:231-234`, `:260`, `:809-812`, `:1275-1278` — then passes `ab` as `client: ServerClient` into `<RightsHydrator>` (`shard-03:207`). Under shard 2's signature every one of those is `Promise<AfrikaBurn<…>>` assigned to a client slot, and shard 3's `refreshDelegation` server action calls `ab.delegate.mint` on a Promise.
**Owner: shard 2** (it owns construction), with shard 3's examples rewritten.
**Fix sketch:** keep async — construction-time reconciliation (`shard-02:348-371`) is the feature and it cannot be synchronous. Shard 1's `Deny<>` inference is unaffected: `const S` inference works through a `Promise` return type. Rewrite shard 3's examples to either top-level `await` in RSC modules or a lazy memoised `getClient()` accessor, and change `RightsHydratorProps.client` to `ServerClient | Promise<ServerClient>` so a module-scope constant still works. Also settle the default type argument, which differs: `readonly [Scope, ...Scope[]]` (`shard-01:530`) vs `ScopeTuple` (`shard-02:247`) — these differ only for `scopes: []`, but they differ.

### A6. The React shard's primary error class does not exist in the error-taxonomy shard

Shard 3 catches `NotAuthorisedError` in every example (`shard-03:696-701`, `:829`, `:1029`, `:1136`, `:1318`, `:1352`) and imports it from `@afrikaburn/sdk/errors`. Shard 2's hierarchy (`shard-02:948-968`) has no such class: it has abstract `AuthorisationError` → `InsufficientScopeError | InsufficientRightsError | RankCeilingError`. Shard 1 uses `NotAuthorisedError` too (`shard-01:26`, `:767`). Three consequences: (a) shard 3's `catch` never fires under shard 2's taxonomy; (b) shard 3's `NotAuthorisedError.code` is `"insufficient_scope" | "insufficient_rights"` only, so a `rank_ceiling` 403 — which shard 2 and shard 4 both make a first-class code — is unhandled in every React example; (c) shard 3 §9.2 does `new AfrikaBurnError("Manifest missing.")` (`shard-03:886`), which is a compile error against shard 2's **abstract** `AfrikaBurnError` with `abstract readonly code` (`shard-02:934-943`).
**Owner: shard 2.**
**Fix sketch:** export `AuthorisationError` under the public alias `NotAuthorisedError` (or rename the abstract base to `NotAuthorisedError` and keep `AuthorisationError` as a deprecated alias) so `instanceof` catches all three arms including `RankCeilingError`; add a concrete `ManifestError`/`ProtocolError` for shard 3's structural assertion instead of instantiating the abstract base; and add shard 3's two orphan classes — `NoCredentialError`, `MissingProviderError` (`shard-03:704-705`) — to shard 2 §8.1 with codes, since they appear in no code table anywhere.

### A7. Delegation tokens impersonate a human in shard 4 and are forbidden from doing so in shard 1

Shard 1 §1.4 (`shard-01:222-224`) rejects "delegating from a real person's `user.id`" as a design, in the sentence the whole synthetic-service-user model rests on. Shard 4 §4.3.12 (`shard-04:1036-1037`) specifies `POST /v1/delegations` with a body containing **`subjectUserId`** — i.e. the token names a subject other than the service user. Shard 3 §3 (`shard-03:88-94`) describes delegation as narrowing-only over "the minting key's effective scopes", with no subject at all, and `ab.delegate.mint({ scopes, ttlSeconds })` (`shard-03:263-267`) passes neither `subjectUserId` nor the `audience` shard 4 requires.
This is not a naming mismatch; it decides whether a delegation token can read `self:profile:read` for a _burner_ (shard 4's `/v1/me/profile` is "delegation token only — a service subject has no bio", `shard-04:350`) or only ever for the service identity (shard 1's model). The entire `self:*` tier's meaning hangs on it.
**Owner: shard 1** (key identity is its section), ruling required.
**Fix sketch:** if delegation may name a burner subject, shard 1 §1.4 needs a fourth bullet explaining why the "rights change silently / inherit the lead-admin backstop" objection does not apply to a ≤10-minute narrowing token (plausibly: because the token cannot outlive the consent moment and cannot mint another) — plus a specification of **how the burner consented**, which no shard supplies. If it may not, shard 4 drops `subjectUserId`, `/v1/me/profile` and `/v1/me/bulletins` become unreachable at any credential, and `self:profile:*` should leave the vocabulary. Either way `ab.delegate.mint`'s signature must be specified once and match the endpoint body exactly.

### A8. The key prefix is `qg_*` in shards 1/2/3 and `ab_sk_*` in shard 4

`qg_live_7fA2…` / `qg_live_`+`qg_test_` at `shard-01:715`, `shard-02:331`, `shard-03:89`, and shard 3's CI test greps client bundles for "the `qg_live_` prefix" (`shard-03:1184`). Shard 4 sets `defaultPrefix: "ab_sk_live_"` (`shard-04:742`), formats `ab_sk_live_<64 chars>` (`shard-04:803-805`), registers the secret-scanning regex `ab_sk_(live|test)_[A-Za-z]{64}` (`shard-04:814-815`), and logs `key_prefix: "ab_sk_live_A7fQ2mZk"` (`shard-04:1333`).
**Owner: shard 4** (it owns the plugin config and the scanner rule).
**Fix sketch:** pick `ab_sk_` — shard 4's argument (one unambiguous regex matching the published `@afrikaburn/*` scope, registered with GitHub secret scanning day one) is the only stated rationale; `qg_` appears without one. Then update the bundle-grep test in shard 3 §12.5, the console `apikey.start` display, and every example string in shards 1–3. Also settle the delegation-token prefix: shard 4 says `abdt_`, shard 3 says "JWT-shaped or opaque (server's choice)" — the SDK cannot dispatch on a credential it cannot recognise.

### A9. `manifest.granted.scopes` is read by shard 2 and does not exist in shard 1's `Manifest`

Shard 2's construction-time reconciliation (`shard-02:352-358`) does `const granted = manifest.granted.scopes`. Shard 1's `Manifest.granted` is `{ org: OrgGrant[]; camps: CampGrant[]; self: SelfScope[]; public: PublicScope[] }` (`shard-01:366-371`) — no flat `scopes`. `OrgGrant` is `{capability, departments, domains, hollow}` (`shard-01:379-384`), so producing scope strings from it requires a flattening rule (cross capability × domains) that no shard writes down, and the `hollow` case (`domains: []`) flattens to **zero** strings — meaning a hollow grant would land in `ScopeContractError.missing` and throw at construction in dev/CI for a scope the key genuinely holds.
**Owner: shard 1** (manifest shape).
**Fix sketch:** add a server-computed `granted.scopes: readonly Scope[]` to the manifest, defined as the flattening of `org` (capability × each domain, **including hollow grants**, since hollow is "granted but reaches nothing", `shard-01:407-415`) ∪ `camps[].permissions` ∪ `self` ∪ `public`; compute it once in `manifestForKey` so it cannot diverge from the structured view. Then specify that `ScopeContractError` reports hollow-but-declared scopes in a **third** bucket (`hollow`, alongside `missing`/`unused`), because throwing on them is wrong and silently passing them is the over-report shard 1 §1.7 rule 1 exists to prevent.

### A10. `X-AfrikaBurn-Manifest-Version` has four different value formats across three shards

`1;kernel=2026.08.05-a17c` (`shard-01:735`), `2027.04.11-a3f9c1` (`shard-02:1022`), `<kernel>.<manifestEtag>` (`shard-04:148`, `:1063`), and shard 3 §9.3 (`shard-03:900-906`) says it carries the kernel not the schema version and proposes renaming it to `X-AfrikaBurn-Rights-Version` "before anything ships". Shard 3 is the only shard that notices `manifestVersion` (document schema, `=== 1`) and `kernel` (rights version) are different things.
**Owner: shard 4** (it owns wire headers).
**Fix sketch:** adopt shard 3's rename and one format: `X-AfrikaBurn-Rights-Version: <kernel>` alone, with the ETag staying in `ETag` where it belongs — packing an ETag into a second header duplicates the conditional-request mechanism and gives the SDK two things to compare. Restate in shard 1 §1.11 and shard 2 §10 verbatim. Same pass should fix the drive-by: shard 2 §10's "headers the SDK reads on every response" table omits `X-Request-Id` (`shard-04:149`) and `RateLimit`/`RateLimit-Policy` (`shard-04:150`, `:1300-1302`), so `AfrikaBurnError.requestId` has no source on a 2xx and `RateLimitError.limit/remaining/resetAt` (`shard-02:987`) has no parser.

### A11. Idempotency: optional vs required, 409 vs 422, two code names, two replay headers

Shard 2 §7.3 (`shard-02:871-882`): `opts.idempotencyKey` is optional, "the SDK does not generate keys automatically", mismatch → `ConflictError` **409** `idempotency_mismatch`, replay marked `X-AfrikaBurn-Idempotent-Replay: true`. Shard 4 §4.1.10 (`shard-04:259-272`): "Required, not optional — an integrator's retry that double-submits a registration … is a support incident with a member in it", mismatch → **422** `idempotency_key_reuse`, replay marked `Idempotency-Replayed: true`.
The optional/required split also breaks shard 2's retry table (`shard-02:896`), which makes writes retryable _only when_ `idempotencyKey` is set — meaningless if the server rejects writes without one.
**Owner: shard 4** (server contract), shard 2 conforms.
**Fix sketch:** required on every non-GET, server-enforced with `ValidationError`/400 when absent; mismatch is 409 `idempotency_mismatch` (409 is the RFC-correct status for a conflicting state and shard 2's `ConflictError` already exists — 422 is for a well-formed request the state refuses, which this is not); one replay header, `Idempotency-Replayed: true` (shorter, and not in the reserved `x-afrikaburn-*` namespace shard 2 §10 rejects on requests). Then the SDK **must** generate a key by default for writes, contradicting shard 2's stated rationale — so shard 2 needs a replacement sentence: an auto-generated key is safe precisely because it is per-call-site and stable across the SDK's own retries only.

### A12. Slug vs groupId addressing is unresolved, and shard 3 calls core methods with the wrong shape

Shard 2's methods are `groupId`-positional throughout: `members(groupId, params?)` (`shard-02:514-516`), `roles.assign(groupId, membershipId, roleIds)` (`shard-02:604`), `rights.has(scope, on?: {groupId: string})` (`shard-02:796`). Shard 4's endpoints are slug-pathed throughout: `/v1/groups/{slug}/members`, `/v1/groups/{slug}/roles`, `PUT /v1/groups/{slug}/members/{id}/roles` (`shard-04:357-362`). Shard 3 uses slug-keyed **object** arguments: `ab.groups.roles.assign({ slug, membershipId, roleIds })` (`shard-03:825`, `:1336`), and `ResourceRef` is `{groupId?, slug?}` (`shard-03:333-336`). Meanwhile `CampGrant` is keyed on `groupId` **and** `slug` (`shard-01:386`), so both are resolvable — but nothing says which the client sends, nor what `useCan("camp:…", {slug})` does when the manifest entry was matched by `groupId`.
**Owner: shard 2** (method signatures).
**Fix sketch:** make every camp-tier method take a single `ref: {groupId: string} | {slug: string}` first argument, matching `ResourceRef`, and specify that the SDK resolves a `slug` to a `groupId` **from the manifest's `CampGrant[]`** with no round trip, falling back to the slug path when the camp is not in the allowlist (which is the invisible-camp case and must produce the identical-bytes response of `shard-04:229`). Convert the roles/invites/questionnaire namespaces to object arguments while doing it — positional `(groupId, roleId, name)` (`shard-02:600`) is the shape that breaks on the next added parameter.

### A13. `react-dom` and `@tanstack/react-query` peer declarations differ between shards 3 and 5

Shard 3 §2 (`shard-03:51-58`): `react` peer `^19`, `react-dom` peer `^19`, `@tanstack/react-query` **peer `^5`** ("Decision 24. Manifest TTL + version-invalidation + SSR hydration _is_ TanStack Query"), `msw` optional peer on `/testing`. Shard 5 §3.3 (`shard-05:399-405`, `:441-445`): `react` peer only, `react-dom` **deliberately not a peer**, `@tanstack/react-query` **optional** via `peerDependenciesMeta`, no `msw`.
Optional is wrong given shard 3 §5.8/§10/§11: `useAfrikaBurnQuery`, `useAfrikaBurnMutation`, the query-key scheme and every invalidation rule are unconditionally TanStack. With `strict-peer-dependencies=false` at the repo root (`shard-05:443`) a missing required peer is invisible locally and surfaces as a runtime crash in a consumer.
**Owner: shard 5** (manifests).
**Fix sketch:** required peer `@tanstack/react-query ^5`; keep `react-dom` off (shard 5's RSC argument is sound and shard 3 gives none); add `msw` under `peerDependenciesMeta.optional` once the `/testing` subpath exists (see C1). Add a `publint`-adjacent assertion that every package imported by `src/**` appears in `dependencies` or `peerDependencies`, since the root `.npmrc` makes pnpm silent about it.

### A14. `@afrikaburn/react` ships at v0.2 but is versioned 0.1.0, published at v0.1, and `fixed`-linked to the SDK

Shard 3 line 3: "Ships in **v0.2** … v0.1 is `@afrikaburn/sdk` only." Shard 5 §3.3 sets `"version": "0.1.0"` (`shard-05:371-372`), §12 item 11 reserves and publishes both at v0.1 as blocking work (`shard-05:1634`), item 13 marks `packages/sdk-react` v0.2 (`shard-05:1636`), and §7 sets `fixed: [["@afrikaburn/sdk","@afrikaburn/react"]]` (`shard-05:1124`) which forces identical version numbers forever.
**Owner: shard 5.**
**Fix sketch:** publish `@afrikaburn/react@0.1.0` at v0.1 as a real package containing only what v0.1 supports — `<AfrikaBurnProvider>`, `useManifest`, `useCan`, `<Can>`, `<RightsInspector>` over `public:*` scopes — since all of those work without the camp/write tranche. That preserves `fixed`, gives the reserved name a real artifact, and defers only the delegation/hydrator/mutation surface. Alternatively drop `fixed` for `linked` and accept version skew, which contradicts shard 5's own decision-25 rationale; the first option is cheaper.

### A15. `assertScopes` is specified as one function living in two mutually-unreachable packages

Shard 1 §1.10 (`shard-01:601-604`) and shard 4 §4.3.8 (`shard-04:915-918`) both declare `assertScopes(m, req)` in `packages/core/src/integration-manifest.ts` — FSL, private, never published. Shard 2 §4.1 (`shard-02:235`) puts "the pure evaluator" in `@afrikaburn/sdk/manifest`, shard 3 §12.3 (`shard-03:1147-1149`) says the mock client "runs the same `assertScopes` gate as the real client", and shard 5's eslint wall (`shard-05:894-895`) bans `@quagga/*` from SDK source outright. So the function must exist twice — the exact "two implementations of one rule" failure the design invokes in six places to justify materialising `manage_roles ⇒ assign_roles` server-side.
**Owner: shard 1** (it owns the invariant), specified in shard 4.
**Fix sketch:** name the duplication out loud and gate it. Add a shared conformance fixture — a committed JSON matrix of `(manifest, request) → verdict` cases — that both implementations are tested against, generated from the FSL side and consumed by both; drift is then a red build in the same way `vocabulary.ts` is. Note explicitly that the SDK's copy is a _string-comparison_ evaluator over a document and re-derives no predicate (which is what keeps the licence argument intact), so the duplication is of the _reader_, not of the policy. Shard 5's drift gate covers `generated/` only (`shard-05:562-565`) and is blind to this.

### A16. Smaller but concrete pairwise conflicts

| #   | Conflict                                                                                                                                                                 | Shards                                                             | Fix owner                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------ |
| a   | `x-api-key` in the resolution-order diagram vs `Authorization: Bearer` with an explicit rejection of `x-api-key`                                                         | `shard-01:437` vs `shard-04:104-109`                               | shard 1 (diagram is stale)           |
| b   | Path prefix `/api/v1/...` vs `/v1/...`; and org paths `/api/v1/suppliers` vs `/api/v1/org/suppliers` vs `/v1/org/suppliers`                                              | `shard-01:747` vs `shard-02:1029` vs `shard-04:174`                | shard 4                              |
| c   | 401 code `unauthenticated` vs `invalid_credential`                                                                                                                       | `shard-02:975` vs `shard-04:208`                                   | shard 4                              |
| d   | Success envelope `{data, nextCursor}` vs `Page<T> = {items, nextCursor}` — no mapping stated, and `ProtocolError` is defined as "the envelope did not parse"             | `shard-04:138-141` vs `shard-02:463-467`                           | shard 2                              |
| e   | Cursor: 15-minute TTL + key-bound (client-side claim) vs HMAC'd base64url with no TTL and no key binding (server spec)                                                   | `shard-02:856` vs `shard-04:277-281`                               | shard 4                              |
| f   | `held_scopes` is on the wire in shard 4's problem+json and absent from shards 1 and 2's; `key_id` holds a key id in shards 1/4 and a **key prefix** in shard 2           | `shard-04:172` vs `shard-01:745`, `shard-02:1032`                  | shard 4                              |
| g   | Console/remediation/API host: `console.afrikaburn.org` / `org.afrikaburn.org` / `api.afrikaburn.org` vs `org.quagga.ryanjnoble.dev` / `api.quagga.ryanjnoble.dev`        | `shard-01:746`, `shard-02:1033`, `shard-02:56` vs `shard-04:36-39` | shard 4                              |
| h   | Refusal ordering table lists **three** codes with `rank_ceiling` as a `reason`; shards 2 and 4 make it a top-level code and class                                        | `shard-01:753-757` vs `shard-02:978`, `shard-04:191-196`           | shard 1                              |
| i   | Audit: OK path unconditionally writes an `audit_events` row in the flow diagram; policy says successful reads are never audited                                          | `shard-01:476` vs `shard-04:1004-1006`                             | shard 1                              |
| j   | Refusal count in prose: "32-cell" vs "40-cell" for the same exhaustive array                                                                                             | `shard-01:423-426` vs `shard-02:818-819`, `shard-04:1085-1086`     | falls out of A1                      |
| k   | `rights.has()` returns `boolean` while `useCan()` returns six states — a hollow grant has no defined `has()` answer, which is the flattening shard 1 §1.7 rule 1 forbids | `shard-02:796` vs `shard-03:323-331`                               | shard 2                              |
| l   | `InsufficientScopeError.refusal` is required; `NotAuthorisedError.refusal` is optional and every React example uses `?? fallback`                                        | `shard-02:1007` vs `shard-03:699`, `:832`                          | shard 2                              |
| m   | Apache-2.0 for the published packages is "this document's _proposal_ … not a fact" in shard 2 and "the decision, not re-argued" in shard 5                               | `shard-02:1421-1427` vs `shard-05:577-579`                         | needs a recorded ruling, not an edit |

---

# B. BRIEF REQUIREMENTS NO SHARD ANSWERS

### B1. Camp/org **creation and management writes** — the headline verb of the brief — are specified nowhere

The brief asks for a package third parties use to "manage theme camps / orgs / profiles". Shard 2 §5 (`shard-02:418-424`) names `ab.groups.create({kind:"artwork"})` as "canonical" and §6.2 (`shard-02:535`) says the kind-sugar namespaces expose "`list`, `get` and (v0.2) `create`" — but **no method table row for `create` exists anywhere in shard 2**, no signature, no input type, and shard 4 has **no `POST /v1/groups`** at any version (its v0.1 list is explicitly "no `POST` anywhere", `shard-04:313`; the v0.2 table has roles/invites/registration/questionnaires but no group creation). There is likewise no `groups.update` (name, description, joinability, categories), no member removal (though shard 2 §8.2 cites "last-lead protection" as a `precondition_failed` cause, implying a removal path), and no lead transfer. Org management reduces to reviewing registrations and suppliers.
**Owner: shard 2 method surface + shard 4 endpoint list.**
**Fix sketch:** add a v0.2 write tranche section: `POST /v1/groups` (backed by `prepareCampCreate`/`createCampWrites`, which shard 1 §1.3 already establishes is the shared all-kinds path), `PATCH /v1/groups/{slug}`, `DELETE /v1/groups/{slug}/members/{id}`. Each needs a scope — and here is the real problem the shards hide: **there is no `camp:` permission for creating a group** (the five `ProjectPermissionKey`s are all _within_ an existing group), so creation is either a `self:` scope, a new scope, or out of scope entirely. That is a vocabulary decision shard 1 must make, and the current 49-string closed list makes it unreachable. State plainly which of the three it is, because "manage theme camps" reads as a promise to create one.

### B2. How a third party actually gets a key — the first five minutes — is unowned

Shard 4 defers the Integrations console to v1.0 (`shard-04:1451`) and says "System managers mint keys by server action until it exists — ugly, safe" (`shard-04:1474-1475`). Shard 5's `mint-local-key.mts` is hard-refused against anything non-local (`shard-05:1557-1571`), correctly. So at v0.1 there is no specified path from "a stranger wants to integrate" to "a stranger holds `ab_sk_live_…`": no application form, no approval criterion, no terms of use, no contact address, no per-integration origin registration (which shard 4 §4.1.9 requires for v0.2 CORS but never specifies collecting).
**Owner: shard 4 §4.3.9, with a persona-table row in shard 1 §1.2.**
**Fix sketch:** specify the v0.1 manual path as a real process, not a shrug: a documented request (integration name, owning department, contact, requested scopes, declared origins), a System-manager server action that creates `integrations` + service user + key + scope rows in one transaction, a one-time plaintext hand-off channel, and a written rule for what an owning department is agreeing to when it sponsors an integration. Roughly one screen of prose; without it the "ugly, safe" fallback is undefined behaviour performed by whoever is on shift.

### B3. `ab_sk_test_` / `qg_test_` promise a sandbox that no shard defines

Both shard 2 (`shard-02:331`) and shard 4 (`shard-04:804`) define a test-key prefix. Nothing says what a test key points at: is there a sandbox environment, a seeded edition, a separate database, synthetic camps? Does a test key work against production with writes suppressed? Shard 5's `sdk-local.sh` (`shard-05:1463-1536`) gives _contributors_ a local stack, not integrators.
**Owner: shard 4.**
**Fix sketch:** either (a) define `ab_sk_test_` as "issued against the preview/staging deployment with its own seeded edition, no production data, no rate-limit sharing" and say where the base URL comes from (`manifest.routes` handles it for free), or (b) delete the test prefix from both shards. Option (b) is defensible at v0.1 and honest; a prefix implying an environment that does not exist is the affordance-that-gets-a-`true` failure applied to infrastructure.

### B4. No event/webhook story, even as a stated refusal

An integrator building a camp tool (the brief's central use case) must poll: shard 2's manifest TTL is 300s, `public:*` reads cache 5 min (`shard-03:970-974`), and there is no notification of a registration decision, a member joining, or a questionnaire activation. No shard mentions webhooks, SSE, or long-polling — not even in the "what we will not add" tables (`shard-02:1463-1483`, `shard-03:1424-1434`, `shard-04:411-424`).
**Owner: shard 4 (proposal), shard 1 (scope implications).**
**Fix sketch:** add an explicit deferral with the reasoning, or a v1.0 proposal. If deferred: say that polling `X-AfrikaBurn-Rights-Version` plus a cursor-paged `updatedSince` filter is the v1.0 substitute — and note that `updatedSince` on `groups` collides with §7.2's ban on filters that are existence oracles (`shard-02:866-868`), which is exactly the kind of tension worth resolving on paper before an integrator asks.

### B5. Nothing specifies the SDK's behaviour for a namespace that is not yet implemented in the current API version

Shard 2 §5 (`shard-02:392-413`) types `notifications`, `registrations` and `org` onto `AfrikaBurn<S>` and annotates them "v0.2" / "v0.2 read / v1.0 write" in comments. A `Since` column exists only on `ab.burners` (`shard-02:562-568`). So at v0.1: do those namespaces exist and throw? Type-check and 404? Are they absent from the emitted `namespaces.ts`? Shard 3's `useCan` has an `unavailable` verdict but it means "manifest fetch failed", not "endpoint not built".
**Owner: shard 2.**
**Fix sketch:** since the whole design's premise is that the SDK is honest about what is reachable, add a `NotImplementedError`/`unsupported_operation` code (currently absent from `shard-02:972-991`) thrown locally by any method whose operation is not in the registry for the manifest's `kernel`, with the same "one gate, one throw site" discipline. Then the emitter can ship the full type surface at v0.1 without lying about it — and `manifest.routes` (which already carries namespace → origin) becomes the natural source: **a namespace with no `routes` entry is not implemented**, which also closes gap D5 below.

### B6. No README specification, and three shards assign it load-bearing sentences

Shard 1 §1.1 (`shard-01:42-43`), §1.10 (`shard-01:646-647`), shard 2 §13 (`shard-02:1463-1466`) and shard 3 §7.2 (`shard-03:722-727`) each require specific sentences to appear in the README verbatim ("hiding a control is never the security boundary"; "the manifest eliminates key-scope errors, not authorisation errors"; the no-server-no-browser-client rule; `preflight: false` documented at the top, not in an options table). Shard 5 §10 says only that it is "hand-written" and "the only prose most integrators read" (`shard-05:1408`).
**Owner: shard 5 §10.**
**Fix sketch:** an outline with the four mandated sentences as required sections, plus the two "deliberately-red build" commit hashes shard 5's own definition of done requires it to carry (`shard-05:1650-1653`), a 60-second quickstart matching shard 2 §1, and the three-personas table so a browser-only integrator learns in the first screen that they need a server. Add it to `licence-boundary.mjs`'s required-files check, which already asserts `README.md` exists but not that it says anything.

---

# C. SUBPATHS, ENDPOINTS AND METHODS REFERENCED BUT NEVER SPECIFIED

**C1. `@afrikaburn/sdk/testing` and `@afrikaburn/react/testing` are imported and never built.** Shard 3 imports `afrikaburnHandlers` from `@afrikaburn/sdk/testing` (`shard-03:1157`) and `buildManifest, grant, camp, refuse, createMockClient, MockAfrikaBurnProvider` from `@afrikaburn/react/testing` (`shard-03:1092`, `:1130`). Shard 2's exports map has four subpaths, none of them `./testing` (`shard-02:1393-1414`); shard 5's tsdown entry list is five files with no testing entry (`shard-05:132-138`) and sdk-react exports only `.` (`shard-05:385-391`). **Owner: shard 5.** Add `./testing` entries to both packages, add `src/testing.ts` to both tsdown configs, and specify the fixture builders' signatures in shard 2 (the core-side ones are undefined even in shard 3 — `buildManifest` is shown by example only). Note the `files` allowlist and `sideEffects: false` both need to keep covering it, and `msw` must become a declared optional peer.

**C2. Query-option factories and the `roster` method.** `ab.groups.roster.queryOptions({slug})` is the backbone of shard 3 §5.8, §9.4, §10.1, §11.2 and §13.2 (`shard-03:523`, `:932`, `:1290`, `:1331`). Shard 2 has `groups.members(groupId, params?) => Page<RosterMember>` (`shard-02:514-516`) and no `roster`, no `queryOptions`, no mention of TanStack at all. Shard 3 asserts the factories "are on the core client and are framework-agnostic" (`shard-03:521-523`, `:941-944`). **Owner: shard 2.** Specify: every read method carries a `.queryOptions(params)` property returning `{queryKey, queryFn}` as a plain object (no TanStack import — `queryOptions()` is an identity function, so producing the object costs nothing), with the query-key scheme from shard 3 §10.1 (`["afrikaburn", keyId, namespace, method, argsHash]`) defined **once**, in shard 2, since `keyId` and `argsHash` are core concerns. Then rename `members`→`roster` or `roster`→`members` consistently across shards 2, 3 and 4 (shard 4's endpoint is `/v1/groups/{slug}/members`, shard 3's MSW fixture is `GET /api/v1/groups/:slug/roster`, `shard-03:1163`).

**C3. `ab.delegate.mint()` and `ab.manifest.fetch()` are called by `<RightsHydrator>` and absent from the client interface.** `shard-03:121-122`, `:219-220`, `:263-267` vs `shard-02:392-413`, where `AfrikaBurn<S>` has neither. Shard 2 exposes the manifest as `ab.rights.manifest()` — synchronous, returns the held document (`shard-02:793`) — which is a different operation from fetching one. **Owner: shard 2.** Add `readonly delegate: DelegateNs` (server entry only, since minting requires the key) with a signature that matches `POST /v1/delegations` field-for-field, and either rename `rights.manifest()` or add `rights.refetch()`; note that shard 2 and shard 3 both cut a global `ab.refresh()` (`shard-02:344-345`, `shard-03:316-317`), so `manifest.fetch()` needs to be justified as construction/hydration-only or it reopens the third staleness hatch.

**C4. `ab.groups.capabilities({slug})` and the `null`-vs-empty mismatch.** Shard 3's canonical page does `const grant = await ab.groups.capabilities({slug}); if (!grant) notFound();` (`shard-03:1286-1287`). No such method exists in shard 2. Worse, shard 4's endpoint (`shard-04:1094-1098`) returns **identical entries** with `permissions: []`, `backstop: false` for all three not-visible cases — an object, never null — so `if (!grant)` never fires and the page renders a roster for a camp the key cannot see. `useCampGrant` has the same shape problem (`shard-03:446-457` says `grant === null` covers the three cases). **Owner: shard 2**, with shard 3's example corrected. Specify one mapping: the SDK converts an all-empty `CampGrant` to `null` at the client boundary (preserving the server's identical bytes while giving the consumer one testable value), and document that `null` is deliberately ambiguous across the three cases.

**C5. Endpoints in shard 2's method tables with no counterpart in shard 4:** `org.accounts.search/roster` and `org.audit.list` (`shard-02:764-765`) — shard 4's org table (`shard-04:380-394`) has neither, and shard 2 itself records that no `read × accounts` or `read × audit` guard call site exists (`shard-02:736-737`); `org.categories.list` (`shard-02:763`), same; `suppliers.get(code)` public (`shard-02:589`) — shard 4 has list only; `notifications.unreadCount` (`shard-02:713`); `registrations.declaredSuppliers` (`shard-02:689`); `questionnaires.activations` / `.close` (`shard-02:661-667`); `editions.active` (`shard-02:483`). **Owner: shard 4.** Either add the endpoints or delete the methods; the current state means seven typed methods have no wire.

---

# D. ERROR CODES, UNDEFINED TERMS, AND UNSPECIFIED ARTEFACTS

**D1. Codes used and never listed in shard 2 §8.2** (`shard-02:972-991`): `integration_suspended` (`shard-04:1075` — and it also contradicts shard 1's flow, which collapses a suspended integration into the opaque 401, `shard-01:441-442`); `invalid_credential`; `idempotency_key_reuse`; `not_visible` (used as a `Refusal.reason` in shard 3's fixture, `shard-03:1109`, and absent from the seven-member union at `shard-01:395-396` and `shard-02:1055-1057`); `escalation_clause` (used as an `InsufficientRightsError.reason` at `shard-02:977` and absent from the same union); plus shard 3's `NoCredentialError`/`MissingProviderError` with no codes. **Owner: shard 2.** One table, closed, with a test asserting `Refusal.reason` and the error-code union have no members that never appear in a server response.

**D2. Types used in signatures and declared nowhere — and the licence problem underneath.** Shard 2's method tables reference at minimum: `GroupKind`, `Joinability`, `MembershipRole`, `RegistrationStatus`, `SectionKey`, `ProjectPermissions`, `ProjectRoleKind`, `RoleColor`, `OfficerKey`, `SupplierStanding`, `InviteKind`, `Invite`, `InviteCreated`, `Activation`, `CampHistoryDisplay`, `BurnerCamp`, `DeclaredSupplier`, `RegistrationDraftPatch`, `SelfProfile`, `SelfProfilePatch`, `RoleCreateInput`, `RoleAppearance`, `SupplierListParams`, `Notification`. Every one is a repo type under FSL, and shard 5's eslint wall bans importing `@quagga/*` from SDK source entirely (`shard-05:894-895`). So all ~24 must be re-declared Apache-side — and shard 5's drift gate covers only `generated/vocabulary.ts` (`shard-05:562-565`), so nothing detects them drifting from the repo's enums. **Owner: shard 5 (emit), shard 2 (enumerate).** Extend `emit-sdk-vocabulary.mts` to emit every closed enum the DTOs reference into `generated/enums.ts` from the same Apache-at-birth source, and extend the drift gate to the whole `generated/` directory (it already globs it, so this is mostly a matter of putting the enums there rather than hand-writing them).

**D3. Terms used and never defined:** `ServerClient` (`shard-03:207`), `BrowserClient` (`shard-03:288` — described as "`AfrikaBurn<S>` with `S` inferred from nothing", never declared; presumably `AfrikaBurn<Scope>`), `RefusalReason` (`shard-03:328`), `AfrikaBurnQueryOptions<T>` / `AfrikaBurnMutationOptions<TVars,TData,TContext>` and their `scopes:` field (`shard-03:504-510` vs its use at `:1014`, `:1335`), `RosterData` / `CampRoster` (`shard-03:1317`), `RefusalRecord` (aliased at `shard-03:637-645` but never re-exported anywhere, and shard 3 explicitly forbids re-exporting it from its own barrel — so consumers must import a type from `@afrikaburn/sdk` that shard 2 exports under a different name than the React component they use it with). **Owner: shard 3**, except `ServerClient`/`BrowserClient`, which shard 2 must declare as the public aliases of `AfrikaBurn<S>`.

**D4. The operation registry — referenced by four shards, specified by none.** Shard 4 requires it committed with a `git diff --exit-code` drift gate (`shard-04:1429`), makes it the enforcement mechanism for the "a scope change on a live operation is a major" rule (`shard-04:87-89`), and shard 5 builds the v1.0 semver CI gate on it (`shard-05:1158-1162`) and the deprecation metadata (`deprecatedIn`/`removeAfterEdition`, `shard-05:1382`). Shard 5 lists `generated/namespaces.ts` as "EMITTED method stubs + @requires/@see JSDoc" (`shard-05:87-88`) with no stated source. Shard 2 refers to "a generated operation table" (`shard-02:1441`) and an `op: string` in `onScopeObserved` (`shard-02:324`) whose format is undefined; shard 4 logs `"op":"org.suppliers.setStanding"` (`shard-04:1332`) and shard 3's mock keys are `"groups.roster"` (`shard-03:1135`). This single artefact ties together the scope→operation map, `X-AfrikaBurn-Accepted-Scopes` values, the emitted stubs, the generated docs, deprecation and the semver gate. **Owner: shard 4 (it is server-side truth), consumed by 2, 3, 5.** Specify its schema now: `{ opId, method, path, namespaceKey, scopes[], since, deprecatedIn?, removeAfterEdition?, requestSchema, responseSchema }`, one committed JSON file, with the `/v1` handler wrapper reading `scopes[]` from it (closing shard 4's "same array literal" guarantee at `:152-156`) and the SDK emitter reading the same file. `opId` is the dotted namespace path and is what `onScopeObserved` and the mock handlers key on.

**D5. `manifest.routes` semantics.** Shard 1 (`shard-01:373`) says `namespace → origin`; shard 4 gives three keys — `capabilities`, `groups`, `org` (`shard-04:64-68`) — for a client with ~13 namespaces (`shard-02:392-413`). Unspecified: which namespaces map to which route key, what the SDK does when a key is absent, and whether `baseUrl` (`shard-02:283`) overrides `routes` or only bootstraps `/capabilities`. **Owner: shard 4.** Make the mapping `namespaceKey → base` where `namespaceKey` comes from the operation registry (D4), state that an absent key means "not implemented in this deployment" (which is also the answer to B5), and state that `baseUrl` bootstraps `/capabilities` only and is ignored thereafter.

---

# E. STAGED-DELIVERY PROMISES WITH NO CORRESPONDING SPEC

1. **Shard 4 task 22 (`shard-04:1429`, marked **[B]** blocking v0.1) includes "the emitted OpenAPI document, committed with a drift gate" — while §4.8's deferred table lists the same OpenAPI document at v1.0 (`shard-04:1452`).** Internal to shard 4; resolve to v1.0, keep the operation registry (D4) at v0.1 since everything else depends on it.
2. **`@afrikaburn/react` at v0.2 requires shard 4's task 27 write tranche (XL, `shard-04:1443`) and task 26 camp reads (L) to land first** — shard 3's entire worked example is `camp:view_member_details` + `camp:assign_roles`. No shard states this as a joint gate; shard 5's ordered change list has `packages/sdk-react` as unblocked item 13. **Owner: shard 5 §12**, add the dependency.
3. **Shard 5 item 11 ("npm org created and owned by AfrikaBurn") is marked **[B]** blocking v0.1 and typed "external"** (`shard-05:1634`), with the fallback `@quagga-portal/*` marked **UNVERIFIED** for availability (`shard-05:1094`). A blocking task with no owner, no date and an unverified fallback is the most likely single cause of v0.1 slipping. **Owner: shard 5 §6**, add a decision date after which the fallback scope is adopted automatically.
4. **`DOCS_BASE` (`shard-05:1428-1441`) flips the `@see` and `remediation_url` host at v1.0, and shard 5 flags this as "deviates from the literal URLs in the architecture's §3.3 code sample and is flagged for review."** It is a genuine deviation: shards 1, 2 and 4 all hard-code `https://developers.afrikaburn.org/...` in generated JSDoc (`shard-01:688`, `shard-02:190`) **and in the RFC 9457 `type` URI** (`shard-01:738`, `shard-02:1025`, `shard-04:165`). The `type` URI is a wire contract, not documentation — flipping it later is a breaking change to a field integrators may branch on. **Owner: shard 4.** Decide the error-`type` namespace once and never move it (a stable `https://afrikaburn.org/errors/...` that redirects is cheaper than a v1.0 flip), and let `DOCS_BASE` govern only the human-facing `@see` links.
5. **Shard 4 defers the per-key camp allowlist table to migration 0030 (`shard-04:1439`) while shard 1 §1.5 rule 3 makes the mint-time allowlist the _definition_ of camp-scope reach** (`shard-01:274-276`). At v0.1 the table does not exist, so `camp:*` scopes are either unissuable or unbounded. No shard says which. **Owner: shard 1.** State that `camp:*` is not issuable at v0.1, full stop — which also makes `loadCampPermissions`'s optional `groupIds` (`shard-04:935-938`) unambiguous.

---

**One meta-observation worth passing up.** Shard 1 claims tie-break authority over "a scope string, a predicate mapping or a refusal shape" (`shard-01:5-7`), but three of the four highest-severity contradictions (A1, A2, A3) are cases where a _later_ shard did verification work shard 1 did not have — bulletins' audience gating, the 40-vs-32 arithmetic, the licence-at-birth requirement. The precedence rule as written would resolve all three the wrong way. Recommend amending it to: shard 1 wins on _shape_ and _vocabulary closure_; a shard presenting a repo citation shard 1 did not consider wins on _membership_, and shard 1 is edited in the same PR.
