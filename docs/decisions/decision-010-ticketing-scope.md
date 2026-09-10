# Decision 010 — Ticketing scope: Quicket vs a camp module

| Field | Value |
| --- | --- |
| **Status** | Open |
| **Raised** | 2026-07-29 (App Spec change record) |
| **Spec section** | §10 Ticket Allocation and Ticket Status (`TICKET-*`) |

## The question

Does the platform build camp-side ticket allocation tooling, or does ticketing
stay entirely with Quicket?

## The divergence

App Spec §10 requires camp-side allocation tooling. The MVP has **no ticket
module at all** and its codebase assumes Quicket remains the system of record.

The kick-off meeting explicitly **assigned research on ticketing infrastructure
before any implementation**, so this module is neither confirmed nor retired.

## The tension worth naming

The roadmap is more decided than the spec: it lists ticketing under **"Out,
permanently"** — "it stays entirely with Quicket; the platform records status at
most and never issues, transfers, or integrates tickets."

So the repo currently holds two positions: the roadmap says never, the spec says
required, and the kick-off said research it first. That contradiction is the
actual thing to resolve, and it should be resolved in one direction or the other
rather than left for whoever reads only one document.

## The middle position, if one is wanted

Recording ticket *status* against a burner ("has a ticket / doesn't") without
issuing, transferring or integrating anything is compatible with both documents.
It is also close to worthless without a Quicket data feed, which is its own AB
dependency.

## What would resolve it

The assigned ticketing research, and AfrikaBurn confirming whether Quicket data
can be read at all. Until then §10 stays at risk and nothing is built.
