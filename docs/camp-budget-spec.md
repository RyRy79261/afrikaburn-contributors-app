# Camp budget, dues and claims — Feature Spec

| Field                  | Value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **Category**           | Engineering Spec                                                                                          |
| **Doc status**         | Draft — built overnight 13–14 Oct at Ryan's request; review before merge                                  |
| **Normative language** | Descriptive only                                                                                          |
| **Requirement IDs**    | Partial — App Spec §7 `BUDGET-001`–`BUDGET-013`, `BUDGET-015`–`BUDGET-018`, `BUDGET-021`–`BUDGET-049`, `BUDGET-054`, `BUDGET-057`–`BUDGET-062`; §8 `PAY-010`–`PAY-013` (as records) |
| **Owner / Updated**    | Ryan, 2026-10-13                                                                                          |

Camps run their money in spreadsheets: a budget by category, who has paid
their camp fee, and who is owed for things they bought for the camp. This
puts the three on the camp, as **records**. The platform never holds, moves,
collects or refunds money (AGENTS.md money law, Decision 009): there is no
"pay" button anywhere. Money moves by EFT between people and the camp's own
bank account; the app records that it did, matched by the member's ref code
(`MAH-M017`).

## Decisions (Ryan, 13 Oct 2026)

- **First build**: budget plan vs actual, member dues, member claims. Bank
  statement matching is **not** in this build.
- **Who sees the books**: the structural lead and co-leads, and members holding
  a new camp privilege **`manage_money`**, see everything. **Every current
  member sees the totals** (planned, spent, income, surplus/shortfall) — open
  books. Nobody but the money people sees another member's dues or claims.
- **Receipts**: photo or PDF upload on claims and expenses, stored privately
  (the same private Vercel Blob pattern as profile photos), readable only by the
  money people and the claimant.

## Model (amounts are whole cents, ZAR only)

- `camp_budgets` (camp, edition) — `default_dues_cents` (the camp fee),
  `payment_instructions` (the camp's own bank details and how to use the ref
  code; free text the lead writes), `contingency_pct`, `status`
  `draft | approved` with `approved_at/by` (`BUDGET-001`, `002`).
- `budget_categories` (camp, edition, name, `kind` `expense | income`,
  `planned_cents`, sort) — a starter list the lead edits, written once per
  camp-edition the first time a money person opens the budget (compare-and-set,
  like shift teams). Expense starters from App Spec `BUDGET-022`–`049` (tents and
  structures, transport, power, water, kitchen, sound, lighting, décor, MOOP,
  build, strike, …); income starters: camp dues, fundraising, donations,
  grants, sponsorship, other (`BUDGET-013`, `015`–`018`, `021`). Archived, never
  deleted, once an entry uses it. An archived category takes no new entries,
  but the entries already filed under it stay correctable in place.
- `budget_entries` (category, amount, date, description, `status`
  `committed | paid`, receipt?, entered_by) — actual income and spending
  (`BUDGET-003`–`005`). An approved claim and a paid due are **not** copied
  here; they are counted in by the derivation, so nothing is entered twice.
- `member_dues` (camp, edition, user, `amount_cents`, `reason`? for a lower or
  higher amount, set_by) — what one member owes; absent = the camp's default.
  Waived is `amount_cents = 0` with a reason.
- `dues_payments` (camp, edition, user, `amount_cents`, `received_on`, note,
  recorded_by) — money a money person **saw arrive** in the camp's account. Any
  number per member: instalments need no plan. Owed − received = outstanding.
- `camp_claims` (camp, edition, user, category?, amount, description, receipt,
  `status` `submitted | approved | rejected | repaid`, decided_by/at,
  decision_note, repaid_on) — a member paid for something for the camp.

Keyed by (camp, edition, user), not by membership: leaving a camp deletes
the membership row, and the books must outlive it. Current vs former is read
from the membership on load; a deleted account's user key is set null and
shows as "Deleted account".

Receipts live under a per-camp private prefix and are served only through an
authorised route; never a public URL. A receipt is a photo (PNG, JPEG, WebP)
or a PDF of at most 4 MB (a Vercel function's request body is capped at
4.5 MB); it is uploaded after its record exists (`POST /api/money/receipts`)
and read through `GET /api/money/receipts/[kind]/[id]`, photos inline and PDFs
as a download.

## Derived figures (`@quagga/core` `camp-budget.ts`)

- Per category: planned, actual (paid entries + approved/repaid claims in that
  category), committed, variance (`BUDGET-009`, `060`).
- Income actual includes dues received; expense actual includes approved claims.
- Totals: projected income / expenditure (`057`, `058`), actual income /
  spend, outstanding dues (`007`), claims owed to members (approved, not yet
  repaid), cash available = income received − spend paid − claims repaid
  (`008`, `061`), forecast final spend = max(planned, actual + committed) per
  category (`006`), contingency (`011`), surplus or shortfall (`012`), cost per
  camper = forecast spend ÷ current members (`010`, `059`).
- Dues per member: owed, received, outstanding, status `awaiting | part paid |
  paid | waived | no fee set`. Waived is an amount of R 0,00 set for the
  member with a reason; "no fee set" is a member on the camp fee while the
  camp fee is still R 0,00 (a new camp), so nobody reads as waived by default.
- Variance per category = planned − (actual + committed): "R … left", or an
  OVER warning when negative. On income rows: "R … to come" / "above plan".
- Projected income / spend use max(planned, actual + committed) per category.
- Surplus or shortfall = projected income − projected spend − contingency
  (`contingency_pct` of planned spend).
- Amounts render with the en-ZA formatter ("R 1 250,00"; "−R 2 025,00").
- Copy never says "payment"/"pay now" as an action: "Record money in", "How to
  pay the camp" (instructions only).

## Rules (`@quagga/core`, enforced server-side)

- **`manage_money`** is a new project permission (custom-role grantable).
  Structural lead/admin hold it irrevocably, like every project permission.
- **Money people** create and edit the budget, categories, entries and dues,
  record payments, and decide claims. A claim's own author cannot approve it,
  even when they hold `manage_money` (another money person must, or a lead).
  Likewise a money person through a custom role cannot set their own dues
  amount or record money in for themselves (`own_dues`); a structural
  lead/admin can, so a camp whose only money person is its lead still works.
- **Members** see: the totals card, their own dues (owed, received, outstanding,
  ref code, the camp's payment instructions) and their own claims. They submit
  and withdraw (while `submitted`) their own claims.
- Non-members: the camp's 404.
- **No money moves**: no amount is ever taken FROM a payer; a payment row is a
  money person's record of money already received. No payment links, no card
  fields, no gateway — ever (Decision 009).
- **Edits are recorded**: every money write writes an `audit_events` row. A
  payment or entry is reversed by a correcting row or a delete that is audited,
  never silently changed.
- **Former members** keep their dues, payments and claims (the books must add
  up); they leave member lists but stay in the dues table marked "former".
- **Account erasure**: claim descriptions, notes and receipts are deleted;
  amounts stay, attributed to "Deleted account", so totals still add up.
- Artworks and vehicles: not in this build.

## Notifications (kind `money`, in-app only)

- Member: your dues amount was set or changed (R 0,00 on the camp fee reads
  "no fee set", never "waived"); a payment was recorded; your claim was
  approved, rejected or marked repaid. A rejection notice points at the claim,
  where the note is; the note is not copied into the notice, because account
  erasure clears it from the claim and preserves notifications.
- Money people: a claim was submitted.

## Surfaces

- `/camps/[slug]/money` — the money page. Money people: the budget (frame M1)
  with plan vs actual by category, entries, the approve-budget action; tabs for
  **Dues** (M2: every member, owed / received / outstanding / status, record a
  payment, set an amount) and **Claims** (M3: queue with approve / reject /
  mark repaid, receipts). Members: the totals card, "Your dues" and "Your
  claims" with the claim form (M4).
- Camp page: a Money tile — totals for everyone; "You owe R…" for the member.
- Roles editor: the new `manage_money` privilege.

## Not built

- Bank statement import and matching (decided against for this build).
- Payment gateway, card capture, payment links, refunds through the app
  (`PAY-001`–`009`, `PAY-015`–`017` as transactions) — never (Decision 009).
- Village dues and shared village costs (`BUDGET-014`, `055`) — no villages.
- Ticket and transport contributions as their own flows (`BUDGET-019`, `020`):
  they are ordinary income categories.
- Fee tiers / pledges, settle-ups, refund rules (Camp 404 has them; later).
- Exports, NPC/PBO bookkeeping, invoice scanning.
