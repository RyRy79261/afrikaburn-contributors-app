# Decision 009 — Payment direction: tracking vs gateway

| Field | Value |
| --- | --- |
| **Status** | **Resolved** |
| **Decided** | 2026-08-12 |
| **Decided by** | Ryan Noble |
| **Spec section** | [§8 Camp Fees and Payment Gateway](../sources/app-specification/app-specification.md) (`PAY-*`) |
| **Supersedes** | The at-risk marker on §8 |

## The question

App Spec §8 requires an integrated payment gateway for camp fees. The MVP
deliberately never touches money — it records a reference and a status. Which is
the product?

## The decision

**The platform does not handle funds. Not now, not as a later phase.**

What it does instead, both of which already exist in the codebase:

1. **Unique codes that identify who a payment is for.**
   - `payments.reference` — `QP-2027-MAH-001`, for an AfrikaBurn-side fee
     (`@quagga/core` `payment-reference.ts`).
   - `memberships.ref_code` — `MAH-M017`, so a camp can reconcile its own EFTs
     against its own bank account (`@quagga/core` `member-ref-code.ts`). This is
     camp-internal and never an AfrikaBurn payment.
2. **A checkbox a staff member ticks** once the money has arrived somewhere else.
   Three states, all reversible: awaiting payment, paid, waived.

AfrikaBurn collects through its existing channels. This app records that it
happened, and says so on every screen where the word "payment" appears.

## Why

The reasons are stacked, and any one of them is sufficient:

- **Compliance.** Holding or routing other people's money makes this a payment
  intermediary, with the registration, audit and liability surface that implies.
  Nobody has asked for that, and no volunteer-run project should acquire it by
  accident.
- **It is not the problem.** The platform exists because people don't fill out
  forms. Camp dues are collected today by treasurers using EFT and a
  spreadsheet, and what fails is not the payment — it is knowing *who* paid.
  A unique code and a tick fixes that. A gateway does not.
- **Scope.** A gateway is a merchant account, a reconciliation flow, a refund
  policy and a dispute process, all owned by AfrikaBurn, none of them decided.
  §8 was at risk precisely because it assumed all four.

## What this forecloses

No card capture, no payouts, no escrow, no camp treasuries, no dues collection,
no refunds. `@quagga/core` `payment-tracking.ts` is where this is enforced rather
than asserted: `assertRecordableAmount` refuses a negative amount on the grounds
that a platform which never took money cannot give any back, and the module
header states that accepting an amount *from a payer* is out of scope by
construction.

Reopening this decision is the prerequisite for any of it, not a detail of a
later ticket.

## Consequences

- **App Spec §8** moves from ⚠️ At risk to a stated direction. The `PAY-*`
  requirements that assume a gateway are not implemented and will not be.
- **Roadmap R1** drops "Payment collection decision with AB" from the blocker
  table — it is no longer blocked, it is decided.
- **Code**: the `payments` table existed and was entirely unused. R1 wires it —
  `recordRegistrationPayment` in `apps/org/lib/actions/payments.ts`, surfaced as
  the Payment card on the registration review screen.
- **AfrikaBurn still owes us** the fee amounts and which channel they want
  referenced. That is a content question now, not an architecture one.
