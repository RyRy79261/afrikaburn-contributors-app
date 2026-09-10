# Decision 013 — Re-baseline the first release scope

| Field | Value |
| --- | --- |
| **Status** | Open |
| **Raised** | 2026-07-29 (App Spec change record) |
| **Spec section** | §20 Suggested First Development Release (`RELEASE-*`) |

## The question

App Spec §20 describes a first release that no longer matches reality — it is
useful as directional intent but diverges from both what the MVP already shipped
and what remains unbuilt. Should §20 be rewritten against the actual state?

## The divergence, concretely

§20's suggested first release and what actually happened have drifted in both
directions.

**Shipped, ahead of what §20 suggested:**

- Three applications, not one (`web`, `org`, `suppliers`)
- Self-hosted Better Auth with 2FA and passkeys
- The full questionnaire engine with per-field privacy, audiences and per-edition
  activation
- Supplier repository, onboarding, documents and standing
- Org role/department permission model with anti-lockout guarantees
- Notifications, bulletins, audit trail, account deletion with POPIA sanitization

**Not shipped, that §20 assumes:**

- Shift management (§6, ❌)
- Camper statistics (§5, ❌)
- Village functionality (§17, ❌)
- Camper communications (§4a, ❌)
- Anything layout or map related (§§11–13)

**Decided away since:** the payment gateway (§8, see
[Decision 009](decision-009-payment-direction.md)).

## Why re-baselining matters

§20 is the section a newcomer reads to learn what "done" means for release one.
While it describes a release that neither happened nor is planned, it actively
misleads — and it is the section most likely to be quoted back at the project by
someone deciding whether it delivered.

## The proposal

Rewrite §20 against the roadmap's R0/R1/R2/R3 structure, which is maintained,
dated and honest about what is committed versus candidate. Keep the original text
struck through per the spec's own "Removed, not deleted" rule so the `RELEASE-*`
IDs still resolve.

## What would resolve it

A maintainer's call — this one needs no AfrikaBurn input. It is blocked only on
someone deciding the rewrite is worth doing, and on
[Decision 007](decision-007-application-boundary.md), which changes what release
one is even scoped to contain.
