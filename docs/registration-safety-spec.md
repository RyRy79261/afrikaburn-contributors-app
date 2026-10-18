# Registration safety: power, fire, gas, fuel and water — Feature Spec

| Field                  | Value                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                                                                            |
| **Doc status**         | Active — decisions taken 18 Oct 2026; frames drawn; not built                                                                               |
| **Normative language** | Descriptive only                                                                                                                            |
| **Requirement IDs**    | Partial — App Spec §14 `REG-006`, `REG-013`, `REG-015`, `REG-016`, `REG-017`, `REG-021`; out: `REG-020`, §15 `PREVYR-017`, `PREVYR-019`–`PREVYR-021` |
| **Owner / Updated**    | Ryan, 2026-10-18 (epic #49)                                                                                                                 |

The App Specification asks a theme camp about power, fire, gas, water and
safety documents. Nothing in the product asks today, and two officer-status
read-outs hard-code "no generator, no open flame, no fuel". We asked the Theme
Camps portfolio what they really use. The answer is much less than the App
Spec lists: three yes/no questions, one follow-up, an optional record the camp
keeps for itself, and two numbers the app works out without asking.

Everything here is pre-event planning. There is no connectivity in Tankwa
Town; nothing in this spec is used on site. Sign-off happens on site, in
person, by the Safety Officer.

## Decisions (Ryan, 18 Oct 2026)

Questions: `/tmp/issue-49-ab-questions.md` (sent to the Theme Camps portfolio),
answered by Ryan the same day.

1. **Generator: yes or no, nothing else.** We need to know whether a camp
   brings one, because it needs fuel and is a sound and fire risk. No size
   (kVA), no main power source, **no fuel estimate**.
2. **Fire: a gate, then which kinds.** The gate "Will your camp have any fire?"
   is right. If yes, we **must** know what kind of fire. Whether interactive
   flame effects need FAST is not settled, so nothing here routes to FAST.
3. **Extinguishers: a set amount per structure.** Derived from the camp's
   layout, never asked. Extinguishers must be serviced; the app says so and
   stores nothing about it.
4. **Gas and fuel: a gate at registration.** "Will you bring LPG gas or liquid
   fuel (petrol, diesel, paraffin)?" is right.
5. **Bottle sizes and quantities, fuel trailers and 200 L barrels: preferably
   known, but not at registration.** A camp can record them early if it wants.
   So they live in an **optional camp record**, not in the registration form.
6. **Over 90 kg of gas or more than 2 × 20 L of fuel: tell the camp and its
   wrangler**, so they talk about how the fuel depot works.
7. **Water: a rough estimator somewhere, not a question.** The water order is a
   separate thing altogether. No grey-water question (the LNT plan covers it).
8. **Safety documents: none.** Sign-off happens on site; extinguishers need
   servicing; anything beyond that is per case. Documents come from different
   people, AfrikaBurn doesn't issue them, and the camp does not upload them.
9. **Policies: make them available, never check reading.**
10. **Carry-forward: documents don't; fuel and inventory-like records do.**

## What is asked, and where

### The three gates and the one follow-up (section 4, Form 2)

They belong to **section 4, Camp Size & Logistics**, which is Form 2: asked in
January, never required for submit (`missingSections` gates Form 1 only), and
not carried forward (`NON_CARRIED_FIELDS` is derived from Form 2).

| # | Question | Kind | Shown when | Required for section 4 complete |
| - | -------- | ---- | ---------- | ------------------------------- |
| G1 | Will you bring a generator? | yes / no | always | yes |
| G2 | Will your camp have any fire? | yes / no | always | yes |
| G2a | Which kinds of fire? | multi-select | G2 = yes | yes, at least one, when G2 = yes |
| G3 | Will you bring LPG gas or liquid fuel? | yes / no | always | yes |

Fire kinds (G2a), stored as stable keys: `braai_brazier` (raised), `fire_pit`
(raised), `burn_barrel`, `gas_cooking_heating`, `flame_effect`,
`fire_performance`, `other`. The list comes from Quaggapedia "Fire, Fire
Safety"; **AfrikaBurn must confirm it** before build (open point 3).

The helper text on G1 says why we ask and that no size or fuel estimate is
needed. Each gate carries its policy link (below). Nothing else is added to
section 4.

**Prefill from the layout (derive over ask).** When the camp's layout for this
edition has a `generator` object, G1 starts at Yes with "Filled in from your
layout"; `fire-pit` does the same for G2 (and ticks `fire_pit`); `gas-storage`
for G3. The camp still confirms: a prefilled answer is shown as answered but
the camp can change it, and changing the layout later never overwrites an
answer the camp gave. This is the effective carry-forward for the gates: the
layout carries forward (camp-layout-spec decision 12), the answers do not.

### Questionnaire vs columns

The issue asks for the questions in the Form 2 **questionnaire** behind
conditional disclosure, with `form-2.ts` mirroring only what other code reads.
Both are true, because both entry points exist today:

- **Form 2 questionnaire.** G1–G3 are added to the seeded
  `org-theme-camp-form-2-*` definition as `single_select` Yes/No questions.
  G2's "Yes" option uses the existing per-option `goTo` to a short "Fire" page
  holding G2a; "No" skips it. That is the engine's existing conditional logic
  (`boolean` cannot branch). **Seed edits do not reach production**
  (`migrate.ts` seeds only a fresh database), so on production AfrikaBurn adds
  the questions to its live Form 2 in the console builder, using the contract
  question ids `has_generator`, `has_fire`, `fire_kinds`, `has_gas_or_fuel`.
  The mirror reports any it cannot place, as it does today.
- **The wizard.** It is still the live path for section 4
  (`mapForm2Answers` is not called anywhere in `apps/` yet). It shows the same
  three gates, with G2a revealed inline under G2 = Yes.
- **Columns, because other code reads them.** Four answers are mirrored into
  `registrations`, and only these four: officer status reads the three flags
  and the org review reads all four.

| Column | Type | From |
| ------ | ---- | ---- |
| `s4_has_generator` | boolean, null = unanswered | G1 |
| `s4_has_fire` | boolean, null = unanswered | G2 |
| `s4_fire_kinds` | jsonb text[] of the keys above | G2a |
| `s4_has_gas_or_fuel` | boolean, null = unanswered | G3 |

`FORM_2_FIELD_MAP` gains the four ids; `ColumnKind` gains `boolean` and
`list`. `Form2Columns` and `RegistrationSectionData` gain the four fields; the
`size_logistics` predicate also requires G1–G3, and G2a when G2 is yes.
Answering G2 = No clears `s4_fire_kinds`.

### Officer status: real values instead of `false`

`apps/org/lib/queries.ts` (`getStatusBoard`) and `apps/web/lib/roles-store.ts`
(`getOfficerStatus`) set `hasGenerators`, `hasOpenFlame` and `hasFuelStorage`
from `s4_has_generator`, `s4_has_fire` and `s4_has_gas_or_fuel` (null reads as
false). **No requirement changes**: `officerRequirements` ignores the three
flags and the fire safety officer stays unconditional
(`questionnaire-spec.md` §officers, `officers.test.ts`). The values are wired so
the two surfaces stop asserting something untrue.

## Derived read-outs (never asked)

Pure `@quagga/core` functions, tested with fixtures from the real vocabulary
(catalog keys and the edition's dates), each with a test that moves the number.

### Water estimate — `waterEstimateLitres`

`5 L × s4ExpectedPopulation × days`, where days counts from
`s4FirstArrivalDate` to the edition's `end_date`, inclusive. Source: Quaggapedia
"Be Waterwise" (5 L a person a day). Returns null when population or arrival
is missing; shown rounded to the nearest 5 L with the sum spelled out
("5 L a person a day × 45 people × 9 days") and the words "a rough guide",
"not a water order", plus the Be Waterwise link.

Shown: under the expected-population field in section 4; on the camp
dashboard's "Gas, fuel & water" tile; as **Water estimate** in the org review.

### Extinguisher count — `extinguisherEstimate(doc, catalog)`

For every **covered structure** in the layout (catalog shelter entries, which
are `nestable`: Bedouin, stretch tent, dome, gazebo, shade): 2 × 4.5 kg DCP
extinguishers and 2 buckets of sand per started 100 m² of that structure's
footprint (`objectFootprint`). Plus 2 per fuel trailer in the gas & fuel
record. Source: the Theme Camp Safety Checklist ("2 × 4.5 kg DCP and 2 buckets
of sand per 100 m² of tent") and the Gas and Fuel Storage policy (2 per
trailer). Private tents (`role: "tent"`) are not counted (open point 1).

Returns the total and one row per structure, so the camp sees where the number
comes from. Always paired with the fixed line "Extinguishers must be serviced.
The Safety Officer checks them on site." Nothing is collected: no count, no
service date, no certificate.

Shown: an **Extinguishers** card in the layout editor's inspector (and the
mobile view), recomputed as the camp draws; a guidance box under the layout
summary in section 4; **Extinguishers (from layout)** in the org review.
With no layout, section 4 shows the rule as text and no number.

## The gas & fuel record (optional camp record)

A camp record, not a registration answer, in the same sense as the layout
(camp-layout-spec decision 12). It is never required, never blocks anything,
and never reaches the registration's completeness.

- **Route:** `/camps/[slug]/gas-fuel`, per edition. Linked from section 4 only
  when G3 = Yes (progressive disclosure), and from the camp dashboard tile.
- **Fields** (one jsonb document, Zod-typed in `@quagga/types`):
  `lpg: [{ sizeKg, count }]` (one row per bottle size), `jerryCans20l`,
  `barrels200l`, `fuelTrailers` (non-negative integers), `note` (free text,
  ≤ 500 chars). Totals are computed, never stored.
- **Who edits:** the camp's leads and co-leads, and holders of
  `manage_layout` (the person who plans the build; no new privilege). Every
  current member may read it. The org reads it in the review. Never public.
- **Carry-forward:** when a returning camp opens the page with no record for
  the new edition and a record exists from the previous one, it offers
  "Start from 2026" or "Start empty", like the layout's "start from last year"
  (`decideStartFromLastYear`). The copy is a **draft**: it doesn't count, shows
  no depot advice to anyone and sends nothing until the camp saves it.
  It never auto-confirms.
- **Policy maximum shown as advice:** "The policy allows at most 100 kg of gas
  per camp" appears with the depot notice. Advice only, never a validation
  error.

### Fuel depot notice — `fuelDepotAdvice(record)`

Pure function. True when **gas > 90 kg**, or **jerry cans > 2** (more than
2 × 20 L), or **any 200 L barrel**, or **any fuel trailer**. Sources: the
Theme Camp Safety Checklist and Theme Camps Guide (90 kg, 2 × 20 L) and the Gas
and Fuel Storage policy (barrels and trailers go to the fuel depot). The
numbers need AfrikaBurn's confirmation (open point 2).

- **Inline:** a warning on the record ("This goes to the fuel depot"), a line
  under G3 in section 4, and **Fuel depot: Over the limit** in the org review.
- **In-app notification, edge-triggered:** when a save turns the advice from
  false to true (and only then), insert one notification to the camp's leads
  and admins (participant app) and one to the camp's assigned wrangler (org
  console): "talk to your wrangler / to them about how the fuel depot works".
  Best-effort after commit, as `notifyWranglerAssigned` does. If no wrangler
  is assigned, the wrangler's copy is sent when one is assigned and the
  advice is true at that moment. Kind: the existing `wrangler` notification
  kind, so the enum does not change. No email.
- The notice is advice to talk, not an approval step. Nothing waits on it.

## Policy links

Plain links, opened in a new tab. Never an acknowledgement, never tracked,
never a checkbox (decision 9):

| Where | Link |
| ----- | ---- |
| G1 | Generator policy — `https://quaggapedia.afrikaburn.com/index.php?title=Generator_policy` |
| G2 / G2a | Fire, Fire Safety — `https://quaggapedia.afrikaburn.com/index.php?title=FIRE%2C_FIRE_SAFETY` |
| G3, gas & fuel record | Gas and Fuel Storage policy — `https://www.afrikaburn.org/afrikaburn-gas-and-fuel-storage-policy/` |
| Foot of section 4 | Theme Camp Safety Checklist — `https://www.afrikaburn.org/event/participation/theme-camps/theme-camp-safety-checklist/` |
| Water estimate | Be Waterwise (Quaggapedia) |

The URLs live in one constant in `@quagga/core` so they change in one place.

## Org review

`apps/org/app/(console)/registrations/[id]/page.tsx`, `buildSectionFields` for
`size_logistics`, adds: **Generator**, **Fire** (with kinds), **Gas or fuel**,
**Fuel depot** (only when a record exists; "Over the limit" chip + what and
when the camp and wrangler were told), **Gas & fuel record** (read-only
summary, only when one exists), **Extinguishers (from layout)**, **Water
estimate**. The placeholder "Power" value in the frames is gone. Unanswered
gates read "Not answered yet (Form 2)".

## Out of scope (by decision, 18 Oct 2026)

- Safety-document upload, expiry dates and certificate tracking for theme
  camps (`REG-020`, `PREVYR-017`, `PREVYR-019`–`021`). `registration_safety_documents`
  stays artworks and vehicles only.
- Certificate carry-forward.
- Policy-read confirmations (`REG-021` is met by the links alone).
- Generator size (kVA), main power source, fuel litres or a carbon estimate.
- A grey-water question; the water order (a separate thing altogether).
- Any FAST routing for flame effects (not settled).
- Any on-site use. Sign-off is in person.

## Database

A schema change is needed. It is generated with `pnpm --filter @quagga/db
db:generate` from `schema.ts` when this is built — **no migration is written
by hand, and none is written now**:

- `registrations`: `s4_has_generator boolean`, `s4_has_fire boolean`,
  `s4_fire_kinds jsonb`, `s4_has_gas_or_fuel boolean`, all nullable, no
  default (null = not answered). Additive; no backfill.
- New table `camp_gas_fuel_records`: `id`, `registration_id` (unique, cascade
  on delete, like `camp_layouts`), `record jsonb not null`, `is_draft boolean`,
  `depot_advice_sent_at timestamptz` (for the edge trigger), `updated_by`,
  `created_at`, `updated_at`.
- No enum change (the notice reuses `wrangler`).

The production Form 2 definition is data, edited by AfrikaBurn in the console;
no migration touches it.

## Requirement IDs

| ID | After this spec |
| -- | --------------- |
| REG-006 (fire) | met by G2 / G2a |
| REG-013 (power) | met by G1 |
| REG-015 (gas / fuel) | met by G3 + the optional record |
| REG-016 (water) | met by the estimator |
| REG-017 (extinguishers / safety equipment) | met by the derived count |
| REG-020 (safety documents) | out, by decision |
| REG-021 (policies) | met by links; no read-check by decision |
| PREVYR-017, 019–021 (certificates) | out, by decision |

`docs/technical-spec.md` §14 and issue #49 should be updated to match when
this is built.

## Open points for AfrikaBurn

1. **Extinguisher rule.** Per structure per started 100 m² (used here) or per
   total 100 m² of tent and covered area? Do private tents count? The checklist,
   the Theme Camps Guide ("per 100 m² camping area") and Quaggapedia ("1 per
   8 × 8 m", "2 per 50 m²") disagree.
2. **Thresholds.** 90 kg of gas and 2 × 20 L of fuel (checklist, guide,
   policy) vs 19 kg and 50 L (`afrikaburn-org/suppliers.md`). And the 100 kg
   per camp maximum.
3. **Fire kinds list.**
4. **FAST** for interactive flame effects in the public area.

## Frames

Participant band (y = 5260):

- Section 4 wizard: `GFtHX` (x 145052) / mobile `sSl0w` (x 146452) — the gates,
  the fire-kinds follow-up, water estimate, extinguisher guidance, the record
  link and the depot line.
- Gas & fuel record: `T7rUD` (x 147072) / mobile `qjdpW` (x 148472) — saved
  state with the depot notice; other states: start from last year, draft,
  within the limits, and the two in-app notices.
- Camp dashboard `RGcNS` / `EQW5G`: "Gas, fuel & water" tile (`RJzGe` / `URe54`).
- Layout editor `f3jmCq` / view `vnpZw`: Extinguishers card (`qi8us` / `fyfiX`).

Organiser band (y = 8660): org review `PRDdG` / `t4Ji4`, Camp Size & Logistics
fields (`LN9Ap` / `oOOW1`).
