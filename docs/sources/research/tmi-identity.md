# AfrikaBurn TMI Identity research

> **Provenance:** adapted from working-group research, Sept 2026 (a description of
> AfrikaBurn's identity platform relayed from the org). External facts are
> **unverified by this repo**.
>
> **Scope:** context only — not a spec, not an engineering decision, and no work
> is planned. This product's own auth is self-hosted Better Auth
> ([`auth-platform-spec.md`](../../auth-platform-spec.md)).

## What TMI Identity is (as described)

- AfrikaBurn's **production identity platform**: one AfrikaBurn account across
  TMI ("Tribe Mobilization Infrastructure") and future connected applications.
- Stated components:
  - **Keycloak** for authentication and single sign-on;
  - the existing AfrikaBurn **LDAP** directory as the authoritative source of
    participant identities and passwords (Keycloak treats it as **read-only**);
  - **PostgreSQL** for TMI's own identity data;
  - transactional email via **Amazon SES**;
  - AfrikaBurn-branded login pages.
- Stated hardening: no uncontrolled self-registration or password reset,
  private administration, tightly restricted network access.
- Sign-in surface: `login.afrikaburn.net`.

## Integration boundary for external apps

- Applications **must not** integrate directly with LDAP, PostgreSQL, or the
  Keycloak database.
- The only boundary is **OIDC / OAuth 2.0**: the application registers as a
  Keycloak client, users sign in at `login.afrikaburn.net`, and the
  application receives a signed OIDC ID Token and a provider-specific OAuth
  access token.
- Any stack with a competent OIDC client library can participate.
- Integration is arranged with **AfrikaBurn IT**.

## Repositories (as named)

| Repo                                                 | Role (as described)                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`AfrikaBurn/TMI`](https://github.com/AfrikaBurn/TMI) | Conceptual modular community-building platform                                          |
| `AfrikaBurn/TMI-Identity`                             | Core identity module; described as live, **private**, and shared only under NDA         |

Do not assume access to `TMI-Identity`, and do not scrape or republish its
internals here.

## Implications (research only)

- A plausible alignment path: this product (or a dedicated auth bridge) as an
  **OIDC client** of TMI Identity — a future "Log in with AfrikaBurn" — rather
  than a parallel AfrikaBurn identity store.
- That does **not** decide whether Better Auth remains the session layer,
  becomes a bridge, or is replaced; that needs org confirmation first.
- Note the direction: this is us as a **client** of the org's IdP, distinct from
  the parked idea of this product acting as an IdP
  ([`auth-platform-spec.md`](../../auth-platform-spec.md) §9.4, §10).

## Open questions

- Formal confirmation from AfrikaBurn IT that the description is current and
  applies to third-party clients.
- NDA / access process if more than the public OIDC boundary is ever needed.
- How existing accounts here would map to AfrikaBurn identities (link, migrate
  or dual-run).
