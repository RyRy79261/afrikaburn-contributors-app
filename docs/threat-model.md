# Security threat model

| Field                  | Value                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Category**           | Security                                                                                                             |
| **Doc status**         | Draft                                                                                                                |
| **Normative language** | Descriptive only — this document reports covered vs open vectors; it does not itself impose new product requirements |
| **Requirement IDs**    | Partial — `SEC-*` (cross-cutting register; per-feature detail lives in the Security docs and is not re-audited here) |
| **Owner / Updated**    | Repo maintainers, 2026-09-26                                                                                         |

Cross-cutting threat register for the **live** product: what can go wrong, what
already stands in the way, and what is still open. Adapted from working-group
material (Sept 2026) and re-checked against this repository where noted.

The controls themselves are specified elsewhere:

- auth architecture, hardening, POPIA and incident runbooks —
  [`auth-platform-spec.md`](auth-platform-spec.md) (§6 hardening, §7
  observability, §8 compliance and runbooks, §9 its own threat model);
- account self-service and security settings —
  [`accounts-security-spec.md`](accounts-security-spec.md);
- deploy, env and migration runner — [`deploy.md`](deploy.md);
- contributor reporting and repository settings — [`../SECURITY.md`](../SECURITY.md).

This file is the **matrix**, not a second source of truth for any one control.
When a row and a feature doc disagree, the feature doc wins on the control and
this matrix should be updated to match.

## Scope

**In scope:** the three deployed apps (`web`, `org`, `suppliers`), the shared
packages they run (`@quagga/{auth,core,db,ui,types}`), the GitHub repository and
CI that ship them, and the Neon / Vercel / Resend operators they depend on.

**Out of scope here (pointed, not ignored):**

- The Draft `/v1` API / SDK delegation surface — specified under
  [`sdk/delegation/`](sdk/README.md) and **not built**. Rows that only apply
  once it ships are marked **Deferred**.
- Physical / on-site device compromise beyond what the apps can enforce.
- AfrikaBurn organisational process outside this repository (staff vetting,
  Quicket, org identity systems).

## Coverage legend

Local to this matrix — not the repo-wide status glyphs in
[`README.md`](README.md).

| Coverage     | Meaning                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| **Covered**  | A real control exists in code, config, or enforced process, and is the intended primary defence |
| **Partial**  | A control exists, but a named gap remains                                                       |
| **Open**     | No adequate control yet; residual risk is not deliberately accepted                             |
| **Accepted** | Residual risk is known and consciously accepted at current scale                                |
| **Deferred** | Threat only becomes real when an unbuilt surface ships                                          |

Rows marked _(unverified)_ restate the source material and were not re-checked
against the code for this adaptation. Likelihood / impact are coarse
(`L` / `M` / `H`), not a formal model.

## Actors

| Actor                       | Intent / capability                                             |
| --------------------------- | --------------------------------------------------------------- |
| Internet stranger           | Credential stuffing, scraping, probing public surfaces          |
| Authenticated burner        | Cross-camp reads, privilege confusion, invite abuse             |
| Camp lead / admin           | Over-reach within or across camps; bulk personal-data exposure  |
| Org staff / `god`           | Highest console authority; misconfiguration or account takeover |
| Compromised dependency / CI | Malicious package, poisoned Action, leaked workflow secret      |
| Operator with env access    | Vercel / Neon / GitHub maintainer holding production secrets    |
| Future integrator (`/v1`)   | Key + ticket abuse — **Deferred** until the SDK work ships      |

---

## Threat matrix

### A — Authentication and account takeover

| ID  | Threat                                 | L / I | Coverage | Primary controls                                                                                                         | Residual / open                                                                                                           |
| --- | -------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| A1  | Credential stuffing / password reuse   | H / H | Partial  | ≥15-char passwords (`PASSWORD_MIN_LENGTH`); DB-backed rate limits (`packages/auth/src/config.ts`, `storage: "database"`) | No breach-password (HIBP) check found in `packages/auth/src` despite the §3 recommendation; no failed-login alerting (F1) |
| A2  | Session theft (cookie / XSS)           | M / H | Partial  | DB sessions + revocation; short cookie cache; HttpOnly cookies                                                           | No CSP/XSS analysis here; the cookie-cache window honours a revoked session briefly                                       |
| A3  | Account takeover without 2FA           | M / H | Partial  | TOTP (backup codes stored encrypted) and passkeys shipped (`twoFactor`, `passkey` plugins)                               | 2FA not mandatory; whether org/god accounts must enrol is open decision #4 in `auth-platform-spec.md` §11                 |
| A4  | User enumeration on auth endpoints     | M / L | Covered  | Generic messages on sign-in / sign-up / forgot-password _(unverified)_                                                   | —                                                                                                                         |
| A5  | SIM-swap via SMS 2FA                   | — / — | Accepted | SMS 2FA deliberately not offered                                                                                         | Authenticator / passkey only                                                                                              |
| A6  | `BETTER_AUTH_SECRET` drift across apps | L / H | Open     | One shared secret set by hand on three Vercel projects (`deploy.md`)                                                     | No drift alert (`auth-platform-spec.md` §7); silent mass logout is the symptom                                            |
| A7  | `god` re-grant after containment       | L / H | Partial  | Session revoke; runbook says to remove the address from `GOD_EMAILS` (`auth-platform-spec.md` §8.10)                     | Easy to miss the env list during an incident                                                                              |

### B — Authorization, privacy, and personal data

| ID  | Threat                                          | L / I | Coverage | Primary controls                                                                                                                                                                                                                                              | Residual / open                                                                                                             |
| --- | ----------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| B1  | Cross-camp data read (app-layer isolation only) | M / H | Accepted | Membership / group filters; cross-camp tests; no Postgres RLS (`auth-platform-spec.md` §9.3)                                                                                                                                                                  | One Postgres, many camps — isolation is entirely application code                                                           |
| B2  | Hard-locked PII in public projections           | M / H | Covered  | `HARD_LOCKED_PRIVATE_FIELDS` in `packages/core/src/privacy.ts`; server-side predicates; no reveal path                                                                                                                                                        | —                                                                                                                           |
| B3  | Medical notes bulk / casual exposure            | M / H | Covered  | `canViewMedicalNotes` (`packages/core/src/medical-access.ts`); detail-only; audience label as consent; encrypted at rest                                                                                                                                      | Audit write fails open by design (B4)                                                                                       |
| B4  | Undetected medical disclosure (audit drop)      | L / M | Accepted | `bio.medical.view` rows written via `after()` (`apps/web/lib/medical-access.ts`, `apps/org/lib/medical-audit.ts`)                                                                                                                                             | A missed audit row is possible under a serverless / DB blip                                                                 |
| B5  | Org staff over-collection / enumeration         | M / M | Accepted | No volume alerting on medical reads (deliberate — AGENTS.md); detail-only surfaces                                                                                                                                                                            | Relies on organisational trust + audit reconstruction after the fact                                                        |
| B6  | UI hiding treated as the security boundary      | M / H | Covered  | Authz predicates in `@quagga/core`, enforced server-side                                                                                                                                                                                                      | Contributor discipline — `SECURITY.md`                                                                                      |
| B7  | ID / passport retention unbounded               | M / M | Covered  | Rule in `packages/core/src/id-retention.ts`; applied by `apps/web/lib/id-retention-sweep.ts` via `apps/web/app/api/account/id-retention-sweep/route.ts`, scheduled daily 03:30 UTC in `apps/web/vercel.json` (commit 51b65e2); returns 500 on partial failure | Depends on `ACCOUNT_SWEEP_SECRET` being set in production — the route is disabled when unset; no alert on cron failure (F1) |
| B8  | Free-camp discovery by strangers                | M / L | Covered  | Directory / type-ahead / profile visibility rules _(unverified in this pass)_                                                                                                                                                                                 | Repo-built rule; a Decision Record is still desirable                                                                       |
| B9  | Org permission model self-escalation            | L / H | Covered  | `god` resolves all; `manage_accounts` refused by the resolver; lockout tests in `apps/org/lib/__tests__/org-role-lockout.test.ts`                                                                                                                             | —                                                                                                                           |

### C — Supply chain and build integrity

| ID  | Threat                                  | L / I | Coverage | Primary controls                                                                                                                                                          | Residual / open                                                                                                                                                                       |
| --- | --------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Malicious or compromised npm package    | M / H | Partial  | Committed `pnpm-lock.yaml`; every CI install is `pnpm install --frozen-lockfile` (`.github/workflows/`); `packageManager` pinned to `pnpm@10.30.0`                        | Nothing inspects a package before install — a malicious version that makes it into the lockfile (via a reviewed bump or a transitive) installs in CI and on contributor machines      |
| C2  | Auto-bump of high-risk auth dependency  | M / H | Covered  | `better-auth` exact pin `1.6.25`; Dependabot `ignore` for `better-auth`, `@better-auth/*` and `@radix-ui/react-slot` (`../.github/dependabot.yml`); manual CVE watch      | Human patch latency on a critical GHSA; no named owner for the watch (`auth-platform-spec.md` §11 #7).                                                                                |
| C3  | Unreviewed dependency drift (general)   | M / M | Partial  | Weekly Dependabot (npm + Actions); minor/patch grouped; no auto-merge                                                                                                     | No severity-based merge gate (OSV / SCA fail-on-PR)                                                                                                                                   |
| C4  | Compromised GitHub Action               | L / H | Partial  | Dependabot for `github-actions`; workflow-level `permissions: contents: read`                                                                                             | Actions pinned by major tag (`@v4`), not by commit SHA                                                                                                                                |
| C5  | Lockfile / SBOM invisible to auditors   | L / L | Open     | Lockfile is the inventory today                                                                                                                                           | No SBOM generated in CI                                                                                                                                                               |
| C6  | Typosquat / brand-new malicious publish | L / H | Partial  | Frozen lockfile means nothing new arrives without a reviewed diff to `pnpm-lock.yaml`; Dependabot version updates wait out a 2-day cooldown (`../.github/dependabot.yml`) | No malware-intel or minimum-package-age check on hand-added dependencies or on young transitives pulled into the lockfile. A new dependency is only as safe as the reviewer of its PR |

### D — Secrets, keys, and configuration

| ID  | Threat                                         | L / I | Coverage | Primary controls                                                                                        | Residual / open                                                      |
| --- | ---------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1  | Secret committed to the public repo            | M / H | Partial  | Contributor rule; secret scanning + push protection recommended in `SECURITY.md` §Repository settings   | Repository settings are maintainer-operated; not verified as enabled |
| D2  | `PGCRYPTO_KEY` leak / no rotation              | L / H | Partial  | Encryption at rest (`packages/db/src/crypto.ts`); single shared key                                     | No key-id / rotation path (`auth-platform-spec.md` §8.4)             |
| D3  | Production probed as "staging"                 | H / H | Covered  | No staging by design; `SECURITY.md` + `AGENTS.md` forbid live testing; local `e2e:local`                | Process control — the apps cannot enforce it                         |
| D4  | Pooled DB URL used for advisory-locked migrate | L / H | Covered  | `packages/db/src/migrate.ts` requires `DATABASE_URL_UNPOOLED` in production and aborts on a pooler host | —                                                                    |
| D5  | Env-less boot crash / secret required at build | L / M | Covered  | All three apps boot to a graceful "not configured" state (AGENTS.md rule 4)                             | —                                                                    |

### E — Repository process and change control

| ID  | Threat                                         | L / I | Coverage | Primary controls                                                                | Residual / open                                                             |
| --- | ---------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| E1  | Direct push / unreviewed merge to `main`       | M / H | Open     | Convention: branch + PR; `.github/CODEOWNERS` exists                            | Branch protection not enabled (AGENTS.md, 3 Aug 2026) — CODEOWNERS is inert |
| E2  | Hand-written migration breaks generator / prod | M / H | Partial  | Rule: edit `schema.ts`, `db:generate`, commit the snapshot; deploy-time migrate | Social enforcement; damage is cumulative                                    |
| E3  | CI permissions over-broad                      | L / M | Covered  | Workflow-level `contents: read` on every workflow in `.github/workflows/`       | Individual jobs may elevate; review on change                               |
| E4  | Public issue leaks PII from in-app reporter    | M / M | Partial  | Pattern-based redaction; no reporter identity on the issue _(unverified)_       | Redaction fails open; read before quoting (`triage.md`)                     |

### F — Runtime observability and incident detection

| ID  | Threat                                | L / I | Coverage | Primary controls                  | Residual / open                                                 |
| --- | ------------------------------------- | ----- | -------- | --------------------------------- | --------------------------------------------------------------- |
| F1  | Auth abuse / secret drift unnoticed   | H / H | Open     | Vercel runtime logs only          | No metrics, dashboards or alerting (`auth-platform-spec.md` §7) |
| F2  | Medical-access misuse as "monitoring" | — / — | Accepted | Explicitly **no** volume alerting | Reconstruction via `audit_events` after an incident report      |
| F3  | No documented DB restore runbook      | L / H | Open     | Neon PITR exists operationally    | SEC-018 — no backup/restore procedure in `deploy.md`            |

### G — Surfaces not yet built

| ID  | Threat                                  | L / I | Coverage | Primary controls (spec only)                                     | Residual / open                                                                                      |
| --- | --------------------------------------- | ----- | -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| G1  | `/v1` key used as a principal           | — / — | Deferred | Ceiling ∩ live end user ∩ consent; no caller-supplied subject id | Not built — [`sdk/delegation/00-decision.md`](sdk/delegation/00-decision.md), AGENTS.md rule 9       |
| G2  | Delegated medical read without audit UX | — / — | Deferred | Burner-facing audit reader required before any medical scope     | [`sdk/delegation/02-audit-and-the-medical-path.md`](sdk/delegation/02-audit-and-the-medical-path.md) |
| G3  | Payment gateway / card data             | — / — | Deferred | Platform never holds money (product law)                         | [`decisions/decision-009-payment-direction.md`](decisions/decision-009-payment-direction.md)         |

---

## Summary

**Covered:** A4, B2, B3, B6, B7, B8, B9, C2, D3, D4, D5, E3 — plus the Accepted
trade-offs A5, B1, B4, B5, F2.

**Partial:** A1, A2, A3, A7, C1, C3, C4, C6, D1, D2, E2, E4.

**Open:**

| ID  | One-line gap                             | Likely next step                                            |
| --- | ---------------------------------------- | ----------------------------------------------------------- |
| A6  | No `BETTER_AUTH_SECRET` drift detection  | Alert or boot-time cross-app check                          |
| C5  | No SBOM in CI                            | Generate CycloneDX/SPDX from the lockfile on `main` builds  |
| E1  | Branch protection off → CODEOWNERS inert | Enable as in `SECURITY.md` §Repository settings             |
| F1  | No auth/ops alerting                     | Minimal failed-login, secret-drift and cron-failure signals |
| F3  | SEC-018 restore procedure undocumented   | Short Neon PITR note in `deploy.md`                         |

Also worth closing from the Partial rows: **A1** (breach-password check).

**Deferred:** G1–G3 — do not build controls in the live apps "just in case";
implement them with the surface that creates the threat.

## How to update this matrix

1. When a control ships or a gap closes, change the row's **Coverage**, shrink
   **Residual / open**, and cite the file that proves it.
2. When a new surface ships (especially anything under `/v1`), add rows or move
   Deferred → Open/Partial/Covered in the same PR as the feature.
3. Do not use this file to invent product policy — that stays in the App Spec,
   Decision Records and feature specs.
