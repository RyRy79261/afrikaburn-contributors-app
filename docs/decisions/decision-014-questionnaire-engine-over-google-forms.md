# Decision 014 — Registration intake: our own questionnaire engine, not Google Forms

| Field | Value |
| --- | --- |
| **Status** | **Resolved** |
| **Decided** | 2026-08-12 |
| **Decided by** | Ryan Noble |
| **Spec section** | [§14 Annual Registration and Placement Submission](../sources/app-specification/app-specification.md) (`REG-*`) |

## The question

The roadmap listed "Google Form access + validation rules" as an AfrikaBurn-owned
blocker against R1 registration hardening: the plan was to mirror AfrikaBurn's
existing Google Form, matching its fields and validation so the platform's
registration was a faithful replacement.

## The decision

**No Google Forms. Registration intake is our own questionnaire engine.**

Access to the existing Google Form is no longer requested, and R1 registration
hardening does not wait on it.

## Why

- **It was a dependency on a system we are replacing.** Building our registration
  to match a Google Form's field-by-field validation makes the form the spec, and
  hands its every quirk to us permanently. The Google Form is the thing being
  retired.
- **The engine already exists and is better.** The questionnaire spine (ported
  from Camp 404) does per-field privacy, conditional logic, audience targeting,
  per-edition activation, camp-scoped answers and structured results — none of
  which a Google Form does. Form 2 is already built on it.
- **It removes a blocker nobody could clear.** The dependency was owned by
  AfrikaBurn and had been open since the roadmap was written. Deciding it away is
  faster than waiting, and costs nothing we wanted.

## What this does NOT mean

The *content* of AfrikaBurn's registration questions is still theirs. This
decision is about the mechanism, not the questions — if AB wants a field, it goes
in. What changes is that we no longer need their form, their validation rules, or
access to their Google account to build ours.

## Consequences

- **Roadmap R1** — "Registration hardening: validation from the real Google Form"
  becomes validation owned by our own questionnaire definitions. The blocker table
  drops the "Google Form access + validation rules" row.
- **App Spec §14** — the `REG-*` requirements are unaffected in substance; the
  implementation route is now stated.
- **No code change.** The registration wizard was never built on Google Forms —
  this decision retires a planned dependency, not an existing one.
