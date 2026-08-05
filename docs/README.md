# Documentation index and conventions

| Field | Value |
|---|---|
| **Category** | Operational |
| **Doc status** | Active |
| **Normative language** | RFC 2119 / RFC 8174 applies |
| **Requirement IDs** | N/A — operational, not spec-derived |
| **Owner / Updated** | Repo maintainers, 2026-08-05 |

This file is the index and the rulebook for everything under `docs/`. If you are
about to read, write, or update a doc in this folder, start here.

`docs/sources/` is out of scope for everything below — it holds verbatim primary
sources (briefs, scope documents, mirrored public pages) and is never edited.
It has its own [`README.md`](sources/README.md).

## Direction of information travel

The **App Specification** is the sole source of truth for what the product
should do. It lives outside this repository, on Superhuman, mirrored to a Coda
change record:

> **App Specification (authoritative):**
> https://docs.superhuman.com/d/AB-Theme-Camp-Development_dQ_I7n93cZT/App-Specification_suoUXVqN

Everything in this repository — every file below, the code, the tests — is
**downstream** of that document. That has one immediate consequence and one
common misunderstanding to avoid:

- **Downstream docs may describe required technical features the App Spec never
  mentions.** Migration discipline, auth architecture, deployment runbooks — none
  of that is in the App Spec, and it doesn't need to be. The App Spec is
  authoritative on *what the product should do*; this repo is authoritative on
  *how, and whether, that gets built*. A doc with no Requirement-ID relationship
  to the App Spec is not a gap — see the **Requirement-ID protocol** below for
  how each doc states its own relationship (or lack of one) honestly.
- **Nothing in this repo may contradict the App Spec and win.** If a doc here and
  the App Spec disagree about what the product *should* do, the App Spec is
  right and the doc is stale. (Docs are free to describe *why the build diverges*
  from the spec — [`technical-spec.md`](technical-spec.md) §4 and §8 do exactly
  that — but that's documenting a known, deliberate gap, not a disagreement about
  which document governs.)

Underneath that top tier, four existing precedence rules already govern this
repo and are restated here as the one place they're spelled out in full. Five
other locations echo it: `AGENTS.md` (×2), [`build-spec.md`](build-spec.md) and
`README.md` restate the rule in full and link here — reasonable for a reader
landing there cold — while [`architecture.md`](architecture.md) links here
without restating it:

1. **The App Specification** (above) governs what the product should do.
2. **[`build-spec.md`](build-spec.md)** wins for engineering — schema, routes,
   stack, hard constraints — where any other doc in this repo disagrees with it.
3. **`AGENTS.md`** wins for process where it and any doc (including
   `build-spec.md`) disagree on process.
4. **`AGENTS.md`** wins over `CONTRIBUTING.md` specifically, where the two
   overlap on process — human contributors still start at `CONTRIBUTING.md`.

## The index

| Doc | Category | Doc status | Requirement-ID coverage |
|---|---|---|---|
| `README.md` *(this file)* | Operational | Active | N/A — index and conventions, not spec-derived |
| [`technical-spec.md`](technical-spec.md) | Product | Active | **Exhaustive** — full 1:1 section mirror of the App Spec |
| [`architecture.md`](architecture.md) | Architecture | Active | Partial — `SEC-*`, `CORE-*` |
| [`build-spec.md`](build-spec.md) | Engineering Spec | Active | Partial — `CORE-*`, `ONBOARD-*`, `CDB-*`, `SEC-*`, `REG-*` |
| [`component-spec.md`](component-spec.md) | Engineering Spec | Active | N/A — implementation detail |
| [`accounts-security-spec.md`](accounts-security-spec.md) | Security | Active | Partial — `SEC-*`, `CDB-002` |
| [`auth-platform-spec.md`](auth-platform-spec.md) | Security | Active | Partial — `SEC-*` |
| [`questionnaire-spec.md`](questionnaire-spec.md) | Engineering Spec | Active | Partial — `ONBOARD-*`, `REG-*`, `SEC-*` |
| [`notifications-spec.md`](notifications-spec.md) | Engineering Spec | Active | N/A — no dedicated App Spec section |
| [`supplier-spec.md`](supplier-spec.md) | Engineering Spec | Active | Partial — `PNP-005`, `REG-011` |
| [`flows.md`](flows.md) | Architecture | Active | Partial — `ONBOARD-*`, `REG-*`, `SEC-*` |
| [`triage.md`](triage.md) | Operational | Active | N/A — operational, not spec-derived |
| [`synthesis.md`](synthesis.md) | Planning | **Historical** | N/A — superseded as an authoritative source by the App Specification itself |
| [`deploy.md`](deploy.md) | Operational | Active | N/A — operational, not spec-derived |
| [`roadmap.md`](roadmap.md) | Planning | Active | Partial — `RELEASE-*` |

Categories: **Product** (what's built vs. the spec) · **Architecture** (how the
system fits together, current state) · **Engineering Spec** (a subsystem's
design) · **Security** (auth architecture, threat model, compliance) ·
**Operational** (runbooks, process) · **Planning** (rationale, release
sequencing).

## Technical language guide

### Normative keywords — RFC 2119 / RFC 8174

> The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
> **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
> **OPTIONAL** in this document are to be interpreted as described in
> [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
> [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they
> appear in all capitals, as shown here.

That is the standard BCP 14 boilerplate. Whether it applies to a given doc is
whatever that doc's own header says under **Normative language** — check the
header, not a list here. (An earlier version of this section named the docs on
each side; a hand-maintained roster of doc names, duplicating a field that
already exists in every file, is guaranteed to go stale the moment a doc is
added or re-marked — the index above is kept current, this prose no longer
tries to be.) Lowercase `must`/`may`/`should` stay ordinary English everywhere,
including in docs marked RFC 2119 applies — capitalisation is what invokes the
RFC meaning, nothing else does.

Docs marked **Normative language: Descriptive only** report what exists or
what's planned; they don't impose requirements, so this convention doesn't
apply to them even where they happen to contain the word "must." See the index
above for which docs are currently marked which way.

### The status-symbol legend

This is the canonical, repo-wide meaning for these four symbols from now on,
copied from where it was first defined in [`technical-spec.md`](technical-spec.md):

| Symbol | Meaning |
|---|---|
| ✅ | **Built** — working in the deployed apps, with tests |
| 🚧 | **Partial** — some of it works; the rest is named nearby |
| ❌ | **Not built** — no code, no database tables |
| ⚠️ | **Blocked** — cannot be built yet, and the blocker is not code |

**A section heading's glyph is a summary, not the last word.** In
`technical-spec.md`, a `##` heading glyph states the section's overall call;
the `**Requirement IDs:**` line beneath it is the authoritative, per-id
breakdown, and the two may legitimately differ in altitude rather than agree —
§8 and §10 head ⚠️ *blocked* while every id they cite is ❌ *not built*, because
the platform's non-negotiable policy stance (never run a payment gateway;
Quicket stays the system of record) isn't quite the same claim as "the code
doesn't exist," even though the practical effect is the same. Where a heading
and its own citation line flatly disagree rather than differ in altitude,
that's a bug, not a difference of perspective — fix the heading.

**One collision to know about, not fix:** [`build-spec.md`](build-spec.md)'s org
capability-matrix table and [`questionnaire-spec.md`](questionnaire-spec.md)'s
role-defaults tables reuse ✅/❌ for a plain boolean "does this role have this
right, yes or no" — a different, older, local meaning that predates this
convention. Those specific pre-existing tables are left as they are (per the
restructure's "don't change content unnecessarily" rule); just don't assume ✅/❌
means "built" in a table clearly answering a yes/no permissions question. New
tables should avoid reusing these four glyphs for plain booleans, to stop the
collision from spreading.

## The standardised metadata header block

Every doc in this folder (except `docs/sources/`, which isn't a spec) carries
this 5-row table directly under its H1, before any other content:

```markdown
| Field | Value |
|---|---|
| **Category** | Product \| Architecture \| Engineering Spec \| Security \| Operational \| Planning |
| **Doc status** | Active \| Historical \| Draft |
| **Normative language** | RFC 2119 / RFC 8174 applies \| Descriptive only |
| **Requirement IDs** | Exhaustive \| Partial \| N/A — with a short qualifier |
| **Owner / Updated** | *name or "Repo maintainers", date* |
```

Field definitions:

- **Category** — one of the six values in the index above. Pick the closest fit;
  don't invent a seventh without updating this table.
- **Doc status** — `Active` (current, maintained), `Historical` (kept for the
  record, not actively updated — state *why* in the doc's own prose if not
  obvious), or `Draft` (not yet reviewed).
- **Normative language** — whether RFC 2119/8174 keywords carry weight in this
  doc. See above.
- **Requirement IDs** — `Exhaustive` (every relevant App Spec requirement is
  cited, doc-wide or section-wide), `Partial` (some are cited, best-effort, not
  audited for completeness — say which prefixes), or `N/A` (this doc has no
  meaningful relationship to the App Spec — say why in one clause, e.g.
  "operational, not spec-derived").
- **Owner / Updated** — who to ask, and when the header (not necessarily the
  body) was last touched.

Worked example, from [`technical-spec.md`](technical-spec.md):

```markdown
| Field | Value |
|---|---|
| **Category** | Product |
| **Doc status** | Active |
| **Normative language** | Descriptive only — this document reports build status; it does not itself impose requirements |
| **Requirement IDs** | Exhaustive — full 1:1 section mirror of the App Specification. Every section below cites the `PREFIX-NNN` IDs it addresses |
| **Owner / Updated** | Repo maintainers, 2026-08-05 |
```

## Requirement-ID protocol

### What the App Spec's IDs look like

Every substantive requirement bullet in the App Specification carries a stable
`PREFIX-NNN` id (e.g. `CDB-014`), one fixed prefix per numbered section,
append-only and never renumbered or reused — a requirement that no longer
applies is struck through in place and annotated, never deleted. The App Spec
itself documents this scheme in full under its own "Requirement ID Conventions"
heading; this repo only ever *cites* those IDs, never mints its own.

### Header-level coverage, by doc type

- **A doc that mirrors an App Spec structure 1:1** (today, only
  `technical-spec.md`, which mirrors all 21 sections): `Requirement IDs:
  Exhaustive`, and every section carries its own inline citation — see below.
- **A cross-cutting engineering doc** serving requirements scattered across
  several App Spec sections, with no dedicated section of its own (e.g.
  `questionnaire-spec.md`, which implements pieces of `ONBOARD-*`, `REG-*` and
  `SEC-*` without the App Spec ever naming "questionnaires" as a section):
  `Requirement IDs: Partial — <prefixes>`, explicitly best-effort and not
  audited for completeness.
- **A purely operational doc** with no relationship to the App Spec at all
  (`deploy.md`, `triage.md`): `Requirement IDs: N/A — operational, not
  spec-derived`.

### Inline citation format

Where a doc cites specific IDs in its body (today, only `technical-spec.md`),
the format is a leading bold-bracketed line grouped by this repo's status
glyph, matching the App Spec's own convention of bolding the ID before the text
it tags:

```markdown
**Requirement IDs:** ✅ CDB-037, CDB-040, CDB-041, CDB-043 · 🚧 CDB-042 · ❌ CDB-029, CDB-030 · ⚠️ CDB-001–CDB-024 *(App Spec §4)*
```

A trailing note in parentheses is fine for a divergence that doesn't reduce to a
single glyph (see `technical-spec.md` §4, §8, §14 for real examples).

**A range must not straddle an id with a different status.** `CDB-040–CDB-043`
inside the ✅ bucket is only correct if `041`, `042` and `043` all genuinely
belong there too — if one of them doesn't, enumerate around it
(`CDB-040, CDB-041, CDB-043`) rather than widening the range and hoping the
gap is obvious from the neighbouring bucket.

### The regeneration protocol

What happens when the App Spec changes — the strict, repeatable procedure this
whole convention exists to support:

1. **The App Spec is edited** (a requirement added, changed, or removed) on
   Superhuman.
2. **The change is logged** in the App Spec's own Change Record, citing the
   specific `PREFIX-NNN` IDs touched — that's the App Spec's own discipline, not
   this repo's, and it's what makes step 4 possible.
3. **Someone brings the change here** — there is no automation watching the
   external doc; a person (or an agent, told to) reads the Change Record entry
   and identifies which `PREFIX-NNN` IDs are affected.
4. **Find every citing location**: `grep -rn "<ID>" docs/` — the header-level
   `Requirement IDs` field and any inline citations both use the literal ID
   string, so this is exhaustive by construction. Also search for the relevant
   wildcard prefix (e.g., `ONBOARD-*` if the ID is `ONBOARD-042`) to catch
   docs that cite the prefix range rather than individual IDs.
5. **A removed ID** is never deleted from a citing doc — struck through in
   place with `(Removed — see Change Record <date>)`, mirroring the App Spec's
   own convention for the same reason: so an old reference resolves to an
   explanation instead of a silent gap.
6. **A changed ID** (the App Spec's own IDs are append-only, so this means the
   *wording* under an existing ID changed): re-read the citing doc's claim. If
   this repo's implementation is unaffected, leave the citation. If the
   technical implication changed, update the doc's prose and note it — this is
   a human judgement call, not a mechanical sync.
7. **A new ID**: check whether this repo's existing prose already covers the
   behaviour (common — the App Spec sometimes catches up to shipped work before
   the reverse). If it does, add the citation. If it doesn't, that's a real
   gap — feed it into `technical-spec.md`'s own ✅🚧❌⚠️ gap-analysis mechanism
   rather than starting a second tracking system.
8. **Update the header** if a whole prefix range is affected, not just one ID.
9. **Cite the Change Record** (date or link) in the commit message for any
   commit that exists specifically to re-sync against an App Spec change — this
   is scoped narrowly to spec-sync commits and doesn't change `CONTRIBUTING.md`'s
   ownership of the general commit-message format.

### Scope, honestly stated

Today, only `technical-spec.md` has been fully retrofitted with per-section
inline citations — it was the mechanical case, since its 21 sections already
mirror the App Spec's 21 sections exactly. The other docs in the index above
carry a header-level, best-effort `Partial` or `N/A` coverage field and nothing
more. Closing that gap — auditing each of those docs' claims against specific
Requirement IDs — is real, deferred work, not a completed retrofit; treat the
`Partial` label as literally true.

## Contributing to these docs

This section is docs-specific only. For setup, commit conventions, the design
canvas workflow, and how to pick up an issue, start at
[`CONTRIBUTING.md`](../CONTRIBUTING.md) — nothing here repeats it.

When you add a new doc under `docs/`, or substantively edit an existing one:

- **It carries the metadata header block** (above), directly under the H1.
- **State Requirement-ID coverage honestly.** An honest `N/A` is worth more than
  a citation you can't back up. If you're not sure a doc relates to the App
  Spec at all, it probably belongs at `N/A`, not a guessed `Partial`.
- **If you cite Requirement IDs in body text, follow the inline format above**
  and add the doc to the index table if it's new.
- **If you're resolving a Requirement-ID change** (App Spec added/changed/
  removed something), follow the regeneration protocol above and say so in the
  PR description — which `PREFIX-NNN` IDs, and which docs you touched because of
  them.
- **Docs review follows the same path as code review** — no separate gate;
  `CONTRIBUTING.md`'s review section applies.
