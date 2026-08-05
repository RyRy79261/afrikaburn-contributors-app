# Simplification audit

A read-only audit of the monorepo for dead code, redundancy, and things that make the
codebase harder to read or collaborate with. No behaviour was changed; nothing here is a bug report.

Seven auditors covered the repo area by area, and every finding was then handed to an independent
agent whose job was to refute it — checking that cited lines say what is claimed, re-running the
`grep`s behind every dead-code claim, and `diff`ing every pair called a duplicate. **66 findings
survived; 4 were refuted** and are listed at the end with the reason, because knowing what is
_not_ worth changing is as useful as the list of what is.

Rough total: **~5,191 lines** that could be deleted or deduplicated.

> **Status.** The dead-code batch (12 findings, listed under "Where to start" step 1)
> has been applied — see the commit following this document. Everything else in this
> file is still a proposal. One dead-code finding was deliberately **not** applied:
> `canManageProjectRoles` (`packages/core/src/questionnaire-authz.ts:100`) has no
> caller, but it carries a dedicated test encoding a real authorization rule, and
> deleting a tested authz predicate to save 20 lines is a bad trade. It is left in
> place on purpose.

| Category             | Findings |
| -------------------- | -------- |
| Redundancy           | 37       |
| Collaboration hazard | 15       |
| Dead code            | 12       |
| Simplification       | 2        |

## Where to start

Ordered by value returned per unit of risk, not by size:

1. **Delete what is provably dead.** Twelve findings, no behaviour to preserve, each independently
   verified by a repo-wide grep. `apps/org/components/questionnaire/builder.tsx` alone is 542 lines
   that nothing imports.
2. **Fix the comments that lie.** Eight findings are documentation asserting something the code
   beneath it contradicts — a barrel manifest advertising two functions that only exist inside a test
   forbidding them, a "change one, change both" warning pointing at a rule that was deleted, an
   `.env.example` that contradicts the repo's own hard rule on migrations. These are pure cost to a
   newcomer and cost nothing to fix.
3. **Collapse the org/suppliers fork.** The largest structural win, and the one needing real review —
   it touches shared packages, which `CONTRIBUTING.md` asks contributors to slow down for.
4. **Then the CI and config duplication**, which is mechanical and easy to verify.

---

## Cross-app duplication (apps/web, apps/org, apps/suppliers)

_Cross-app duplication is the dominant quality problem in this repo, and it is systemic rather than incidental: apps/org and apps/suppliers are close to being the same application twice. I diffed every candidate pair/triple named in the brief plus everything else with a matching path. Roughly 2,000 lines are genuine copies whose diffs are nouns ("console"/"portal"), route paths (/auth/sign-in vs /signin), one CSS token (text-accent vs text-primary), and an app slug literal ("web"|"org"|"suppliers"). The clearest evidence that this is drift and not design: apps/org/components/sign-out-button.tsx and apps/suppliers/components/sign-out-button.tsx have the same md5; apps/org/lib/actions/password.ts and apps/suppliers/lib/actions/password.ts differ in 2 of 81 non-comment lines; apps/org/components/account/account-clients.tsx and its suppliers twin differ in 5 lines out of 100. Copies have already started diverging in ways nobody chose — org's mark-all-read button silently lost the success toast the other two have, and suppliers' auth-client comment dropped a plugin note web still carries. Plenty IS justified and I did not report it: the three lib/session.ts gates ask genuinely different questions (camp membership / org rank / supplier claim); the org and suppliers gate-screen.tsx render different states and org's file explains in a comment why it does not adopt the @quagga/ui GateScreen primitive (double quilt band); apps/web's account, password and deletion flows are legitimately richer because that app owns deletion; the app/api/auth/[...all]/route.ts and app/api/report/\*/route.ts triples are thin Next-convention entrypoints that are correctly thin; and the three app/layout.tsx files carry real per-app branding. Neither AGENTS.md nor CONTRIBUTING.md sanctions per-app duplication — CONTRIBUTING.md's "where things live" explicitly names packages/ui as "shared components — used by all three", so consolidating is following the stated convention, not overriding it. The one caution worth flagging to whoever acts on this: CONTRIBUTING.md asks contributors to pause before touching packages/core and packages/db because they change three apps at once, so the notifications-backend consolidation should be its own reviewed PR rather than folded into a larger cleanup._

### The whole `(account)` suite is a fork: org and suppliers carry ~900 duplicated lines that differ only in nouns and sign-in paths

**Redundancy** · ~400 lines · confidence: high

Sites:

- `apps/org/components/account/account-clients.tsx:1`
- `apps/suppliers/components/account/account-clients.tsx:1`
- `apps/org/app/(account)/account/security/page.tsx:1`
- `apps/suppliers/app/(account)/account/security/page.tsx:1`
- `apps/org/lib/actions/account.ts:1`
- `apps/suppliers/lib/actions/account.ts:1`
- `apps/org/lib/account.ts:75`
- `apps/suppliers/lib/account.ts:61`

apps/org and apps/suppliers each ship a private copy of the same account suite. `components/account/account-clients.tsx` is 100 vs 97 lines with FIVE changed lines (a comment word plus one deleted paragraph) — the wiring itself is identical. `app/(account)/account/security/page.tsx` (146 vs 141) differs only in `resolveConsoleAccount`→`resolvePortalAccount`, `/auth/sign-in`→`/signin`, the function name and prose. `lib/account.ts` lines 55-89 (org) are byte-identical to suppliers' 41-75: the same cached resolve, the same `require*Account` throwing the same string, and the same three one-line `sharedList*` re-wrappers. `lib/actions/account.ts` is 142 non-comment lines in org with 36 differing — and most of those are the `linkApp: "org"|"suppliers"` literal and an email-sender seam. Nothing here is per-app product policy; it is one feature written twice, which means every future account-security fix has two homes and one of them will be missed.

**Evidence.** `diff -u apps/org/components/account/account-clients.tsx apps/suppliers/components/account/account-clients.tsx` → 5 changed lines. `diff -u apps/org/app/(account)/account/security/page.tsx apps/suppliers/.../security/page.tsx` → only identifier/route/copy hunks. `diff -u apps/org/lib/account.ts apps/suppliers/lib/account.ts` → hunk header `@@ -89,97 +75,33 @@` proves lines 45-89 match exactly. Comment-stripped diff of `lib/actions/account.ts`: 36 of 142 lines.

**Fix.** Hoist the shared half into `packages/ui` (the client wiring, which already imports every card from `@quagga/ui/components/account-*`) and `packages/auth` (`resolveAccountUser`+`require` pair, the `listAccountSessions/Passkeys/LinkedAccounts` header wrappers — `packages/auth/src/account.ts` already takes `Headers` explicitly to stay Next-free, so they fit). Parameterise the three real variables: `signInHref`, `linkApp` slug, and the email-sender function. Leave only per-app copy in the apps.

> **Verifier.** Partly confirmed, materially overstated. CONFIRMED by my own diffs: components/account/account-clients.tsx is 100 vs 97 with exactly 5 changed lines (one comment word + a deleted paragraph); app/(account)/account/security/page.tsx is 146 vs 141 and every hunk is resolveConsoleAccount->resolvePortalAccount, /auth/sign-in->/signin, the exported function name, and prose; lib/actions/account.ts (215 vs 213) is near-verbatim apart from requireConsoleAccount->requirePortalAccount, linkApp "org"->"suppliers", and a genuinely different email seam (org: optional mail arg via lib/email sendEmail in try/catch; suppliers: unconditional @quagga/auth sendSingleEmail). REFUTED sub-claims: (a) 'lib/account.ts lines 55-89 (org) are byte-identical to suppliers 41-75' is false — the cached resolve AND the require*Account pair are both inside diff hunks (different names, different docs); the only byte-identical region is org 75-88 / suppliers 61-74, the three sharedList* wrappers, ~14 lines. The stated evidence ('hunk header @@ -89,97 +75,33 @@ proves lines 45-89 match exactly') misreads diff semantics. The rest of lib/account.ts is entirely different code: getOrgAccountHoldings (org rank, role count, LIVE System-manager count with a sanitizedAt exclusion, ~118 lines) vs getClaimedSupplier (~33 lines). (b) 'Nothing here is per-app product policy' is false for three of the ten cited files: (account)/layout.tsx differs by session shape (resolveOrgSession OrgSession spread vs resolveSupplierSession state fields into PortalHeader), header component, icon, max-w-6xl vs 5xl; account/page.tsx carries an ORG_RANK_LABELS standing card and resolveOrgSession on the org side only; account/delete/page.tsx carries the org's last-live-System-manager REFUSAL case that suppliers has no analogue for. Real removable duplication is ~400 lines, not 600/900.

### Forgot-password and reset-password forms exist in all three apps, functionally identical

**Redundancy** · ~340 lines · confidence: high

Sites:

- `apps/web/components/account/forgot-password-form.tsx:1`
- `apps/org/components/auth/forgot-password-form.tsx:1`
- `apps/suppliers/components/auth/forgot-password-form.tsx:1`
- `apps/web/components/account/reset-password-form.tsx:1`
- `apps/org/components/auth/reset-password-form.tsx:1`
- `apps/suppliers/components/auth/reset-password-form.tsx:1`

672 lines across six files implementing two forms. All six import the same `@quagga/ui` Button/Field/Input/PasswordInput/toast, hold the same `email`/`pending`/`sent` state, call an identically-shaped server action, and render the same two-state (form → confirmation) flow. The org↔suppliers diff for forgot-password is: the sign-in href, the email placeholder, `text-accent` vs `text-primary`, and `font-semibold tracking-tight` added to an `<h1>`. The reset form's org↔suppliers diff is the same href plus the same heading class. Web's pair differs only by having longer comments and one extra reassurance paragraph. These are enumeration-safety-critical surfaces — the confirmation must render in place rather than redirect, and the missing-token screen must be a separate screen — and that invariant is currently asserted by three copies of the same JSX.

**Evidence.** `wc -l` on the six files: 116/104/108 and 118/112/114. `diff -u apps/org/components/auth/forgot-password-form.tsx apps/suppliers/components/auth/forgot-password-form.tsx` → 5 hunks, all href/placeholder/class/copy. `diff -u apps/web/components/account/reset-password-form.tsx apps/org/components/auth/reset-password-form.tsx` → the only non-comment hunk is the action import path.

**Fix.** Put both forms in `packages/ui/src/components/` (they already depend on nothing but `@quagga/ui` primitives) with props for `signInHref`, `emailPlaceholder`, `introCopy`, and the server action passed in — the same injection pattern `account-auth-client.ts` already established for the 2FA cards. Each app keeps a ~10-line wrapper.

> **Verifier.** Confirmed, and the strongest of the set. wc -l matches exactly: 116/104/108 and 118/112/114 (672 total). diff org vs suppliers forgot-password: 5 hunks, all of them the /auth/sign-in vs /signin href, the placeholder, text-accent vs text-primary, `font-semibold tracking-tight` on the h1, `required` on the Field, and one copy word. diff web vs org reset-password: the ONLY non-comment hunk is `@/lib/account-actions` vs `@/lib/actions/password`. diff org vs suppliers reset-password: the same href and heading classes. Web's forgot form differs only by longer comments plus one extra reassurance <p>. The two-state in-place confirmation and the separate MissingToken screen are present in every copy, so the enumeration-safety invariant really is asserted three times. Minor imprecision only: the forgot forms import Button/Field/Input (not PasswordInput/toast) and the reset forms import Button/Field/PasswordInput/toast — not all six import all five.

### `lib/notifications.ts` is written three times; the only real difference is the string "web"/"org"/"suppliers"

**Redundancy** · ~280 lines · confidence: high

Sites:

- `apps/web/lib/notifications.ts:28`
- `apps/web/lib/notifications.ts:134`
- `apps/org/lib/notifications.ts:27`
- `apps/org/lib/notifications.ts:120`
- `apps/suppliers/lib/notifications.ts:23`
- `apps/suppliers/lib/notifications.ts:109`

All three apps export the same five symbols — `getUnreadNotificationCount`, `NotificationView`, `listNotificationGroups`, `recentNotifications`, `insertNotifications` — with the same drizzle queries, the same `notificationLinkIsLocal(r.linkApp, <slug>)` projection, the same `NOTIFICATION_INSERT_CHUNK = 1000` loop and the same eight-column insert mapping. Only the app slug and the session-resolution seam differ. The chunking loop in particular is a hard-won piece of knowledge (its comment recounts a live bulletin fan-out that rolled back) copied verbatim into three files, so the next person to fix it fixes one third of the problem. The comments have already drifted apart from themselves inside each copy: the const's doc says "Eight bound columns each, so … 8191 rows" while the loop comment ten lines below says "Six bound parameters per row … dies at 10923 rows" — both wrong-in-different-ways statements, triplicated.

**Evidence.** `grep -n "^export " apps/{web,org,suppliers}/lib/notifications.ts` → same five exports in each. `diff -u apps/org/lib/notifications.ts apps/suppliers/lib/notifications.ts` → hunks are the slug literal, the `DbHandle`/`Database` type name and doc prose. `grep -n "bound parameters per row|bound columns each" apps/*/lib/notifications.ts` → the contradiction appears at web:124/139, org:111/125, suppliers:101/114.

**Fix.** Move the reads and `insertNotifications` into `packages/db` (it already owns the schema and drizzle) as a factory: `createNotificationsApi({ app: "web"|"org"|"suppliers" })`. Each app's `lib/notifications.ts` becomes the factory call plus whatever is genuinely local (suppliers' `getBulletinForSupplier`). Fix the chunk comment once while collapsing it.

> **Verifier.** Confirmed. grep of `^export` gives the same five symbols in all three files at web:28/45/60/97/134, org:27/50/78/97/120, suppliers:23/40/68/87/109 (suppliers additionally has SupplierBulletin/getBulletinForSupplier, which the finding already concedes as genuinely local). diff org vs suppliers: hunks are the "org"/"suppliers" literal in notificationLinkIsLocal and resolveNotificationLinkApp, the DbHandle vs Database handle type, and doc prose. The chunking block is verbatim in all three, and the contradiction is exactly where claimed — NOTIFICATION_INSERT_CHUNK doc says 'Eight bound columns each ... 8191 rows' at web:124/org:111/suppliers:101 while the loop comment says 'Six bound parameters per row ... dies at 10923 rows' at web:139/org:125/suppliers:114. Only real behavioural seam is session resolution: web resolves getCurrentCampUser internally and takes no userId, org takes an optional userId with a resolveOrgSession fallback, suppliers requires userId — which is what the finding says.

### Six small components/modules copied verbatim between org and suppliers, one differing by a single CSS token

**Redundancy** · ~200 lines · confidence: high

Sites:

- `apps/org/components/sign-out-button.tsx:1`
- `apps/suppliers/components/sign-out-button.tsx:1`
- `apps/org/components/page-heading.tsx:19`
- `apps/suppliers/components/page-heading.tsx:19`
- `apps/org/lib/actions/result.ts:1`
- `apps/suppliers/lib/actions/result.ts:1`
- `apps/org/components/not-configured-banner.tsx:1`
- `apps/suppliers/components/not-configured-banner.tsx:1`
- `apps/org/components/header-notification-bell.tsx:1`
- `apps/suppliers/components/header-notification-bell.tsx:1`
- `apps/org/components/account/account-shell.tsx:17`
- `apps/suppliers/components/account/account-shell.tsx:17`

`sign-out-button.tsx` is BYTE-IDENTICAL between org and suppliers (same md5). `page-heading.tsx` differs by exactly one token on line 19 (`text-accent` vs `text-primary`). `lib/actions/result.ts` differs by one word in one comment ("console's" vs "portal's") — the type itself is one line. `not-configured-banner.tsx` and `header-notification-bell.tsx` differ only in prose and a default value. The three `account-shell.tsx` wrappers are the same 55-line wrapper over `@quagga/ui`'s `AccountShell`, with a byte-identical `SECTIONS` array, differing only in the footer JSX. Individually trivial; together they are the pattern that makes contributors assume copy-paste-across-apps is how this repo works.

**Evidence.** md5 of `components/sign-out-button.tsx` is `1c9043bf` for BOTH org and suppliers. `diff -u` on each pair: page-heading → 1 hunk, 1 token; result.ts → 1 hunk, 1 comment word; not-configured-banner → 2 prose hunks; header-notification-bell → comment + `count = 0` default. `grep -n 'const SECTIONS'` at web:20, org:18, suppliers:17 with identical three-entry arrays.

**Fix.** `SignOutButton`, `PageHeading` and `NotConfiguredBanner` go to `packages/ui` (PageHeading with an `eyebrowClassName` or, better, both apps standardising on one accent variable). `ActionResult` goes to `packages/types`. Delete the `account-shell.tsx` wrappers entirely and pass `sections`+`footer` to the shared `AccountShell` at the ~6 call sites — the wrapper adds nothing but a footer literal. Drop `header-notification-bell.tsx`, which is a one-line pass-through to `NotificationPanel`.

> **Verifier.** Confirmed item by item. md5sum of components/sign-out-button.tsx is 1c9043bfebf141494833e3cdc81992d3 for BOTH org and suppliers (byte-identical). page-heading.tsx: one hunk, one token, text-accent vs text-primary, at line 19 in both as cited. lib/actions/result.ts: one hunk, the word console's vs portal's, and the type itself is the single line 4. not-configured-banner.tsx: two prose hunks. header-notification-bell.tsx: comment plus `count?: number` vs `count = 0`, and it really is a one-line pass-through to NotificationPanel. account-shell.tsx: 57/55/54 lines, `const SECTIONS` at web:20 org:18 suppliers:17 and the arrays produce no diff hunk in either pairwise diff, so they are identical across all three; the diffs are the header comment and the footer JSX only. Sizes total 193 lines for the org-side copy of the six, so 200 is accurate rather than inflated. One caveat on the fix: web's account-shell comment claims the section list is a prop 'because' web is the only app with all three sections — that rationale is already stale, since all three SECTIONS arrays are identical.

### Three names, three locations, three shapes for the same jobs across the three apps

**Collaboration hazard** · ~120 lines · confidence: high

Sites:

- `apps/web/lib/db.ts:22`
- `apps/org/lib/db.ts:27`
- `apps/suppliers/lib/db.ts:22`
- `apps/org/lib/actions/result.ts:4`
- `apps/org/lib/actions/account.ts:39`
- `apps/org/lib/actions/password.ts:20`
- `apps/web/components/notifications/format.ts:19`
- `apps/org/components/notifications/relative-time.ts:11`
- `apps/org/lib/status-board-format.ts:89`

The same job has a different name and address in each app, so knowledge does not transfer. (1) Server actions: web uses `lib/<domain>-actions.ts` (account-actions, notifications-actions), org and suppliers use `lib/actions/<domain>.ts` — there is no `apps/web/lib/actions/` at all. (2) The DB transaction handle is `Tx` in web, `OrgTx` in org, `Transaction` in suppliers; the "db or tx" supertype is `DbHandle` in org and `DbOrTx` in suppliers; the client accessor is `db()` in web and `getDb()` in the other two. (3) The action result discriminated union exists three times in org alone under three names with the same shape (`ActionResult`, `AccountActionResult`, `PasswordActionResult`). (4) Relative-time formatting: web and suppliers export `relativeTime` from `components/notifications/format.ts`, org exports `timeAgo` from `components/notifications/relative-time.ts`, and org ALSO has a third, differently-formatted `relativeTime` in `lib/status-board-format.ts` ("3 h ago" vs "3 hours ago"). `dayGroupHeading` is byte-identical in web and suppliers and absent in org. None of this is documented in AGENTS.md or CONTRIBUTING.md as intentional.

**Evidence.** `ls apps/web/lib/actions` → no such directory; `ls apps/{org,suppliers}/lib/actions` → 12 and 7 files. `grep -n 'export type Tx|OrgTx|Transaction|DbHandle|DbOrTx'` → web:22, org:27/30, suppliers:22/27. `grep -n 'export type .*ActionResult'` → org/lib/actions/result.ts:4, account.ts:39, password.ts:20. `diff` of the `dayGroupHeading` bodies in web and suppliers → identical. `grep -rn relativeTime\|timeAgo` shows the three implementations and org's status-board test at lib/**tests**/status-board-format.test.ts:82 asserting the third format.

**Fix.** Pick one layout and one vocabulary and write it into AGENTS.md: `lib/actions/<domain>.ts` everywhere, one `Tx`/`DbOrTx` pair exported from `@quagga/db` instead of re-derived per app, one `ActionResult` in `@quagga/types`, and one `relativeTime` in `packages/core` (which is already pure and dependency-free) with a variant flag for the compact status-board form.

> **Verifier.** Mostly confirmed, one sub-claim refuted. CONFIRMED: `ls apps/web/lib/actions` -> No such file or directory, while apps/org/lib/actions has 12 files and apps/suppliers/lib/actions has 7. Handle types are exactly as cited: web/lib/db.ts:22 `export type Tx`, org/lib/db.ts:27 `DbHandle` + :30 `OrgTx`, suppliers/lib/db.ts:22 `Transaction` + :27 `DbOrTx`; accessor is `db()` at web:10 and `getDb()` at org:13 / suppliers:12. relativeTime is at web/components/notifications/format.ts:19 and suppliers/components/notifications/format.ts:19, timeAgo at org/components/notifications/relative-time.ts:11, and a third differently-formatted relativeTime at org/lib/status-board-format.ts:89 ('12 min ago' / '3 h ago' / '2 d ago'), asserted by apps/org/lib/**tests**/status-board-format.test.ts. dayGroupHeading is byte-identical in web:85 and suppliers:48 and absent from org. Nothing in AGENTS.md or CONTRIBUTING.md documents any of this as a deliberate convention (I grepped both). REFUTED: 'the same shape' for org's three result unions — result.ts:4 ActionResult is `{ok:true} | {ok:false;error}` while account.ts:39 AccountActionResult and password.ts:20 PasswordActionResult are `{ok:true;message?} | {ok:false;error}`. Two of the three match; the third does not, so collapsing all three to one type is not a pure rename. Also partly taste: web's relativeTime and org's timeAgo diverge in real behaviour past 24h (weekday/date vs 'Yesterday'/'N days ago'/en-ZA date), so unifying them is a product-copy decision, not a mechanical merge.

### `lib/actions/password.ts` is a byte-copy between org and suppliers — 2 differing lines out of 81

**Redundancy** · ~110 lines · confidence: high

Sites:

- `apps/web/lib/account-actions.ts:246`

Stripped of comments, org's and suppliers' password actions differ in exactly two lines: one sentence of error copy ("Ask an administrator for help" vs "Contact AfrikaBurn for help"). Everything else — the zod schemas, the `RESEND_API_KEY` availability refusal, the shared `forgot_password:<ip>` rate-limit bucket, the deliberately-swallowed `auth.api.requestPasswordReset` throw, the `assessPassword` gate — is identical. Web has a third implementation of the same two actions with a genuinely richer body (it also resolves the reset token's identity and writes a security event). So the enumeration-safety contract and the rate-limit budget are asserted in three places; the two that are supposed to be the same have already lost their explanatory doc comments in one copy but not the other.

**Evidence.** `diff <(strip org/lib/actions/password.ts) <(strip suppliers/lib/actions/password.ts) | grep -c '^[<>]'` → 2, against 81 non-comment lines. The raw `diff -u` shows suppliers has deleted the two doc blocks that org still carries above `requestPasswordReset` and `resetPassword`.

**Fix.** Move `requestPasswordReset` / `resetPassword` into `packages/auth` (it already owns `auth`, and `packages/db` already owns the limiter constants), taking `{ redirectTo, unavailableMessage }` as options. Web's extra identity/security-event step becomes an optional `onReset` callback rather than a third fork.

> **Verifier.** Confirmed. org is 111 lines / 81 non-comment (I counted); the raw diff has exactly one changed code line — 'Ask an administrator for help' vs 'Contact AfrikaBurn for help' — and everything else is comment: the header paragraph plus the two doc blocks above requestPasswordReset and resetPassword that suppliers has deleted, exactly as claimed. The zod schemas, the isAuthConfigured refusal, the `forgot_password:<ip>` bucket with FORGOT_PASSWORD_MAX_PER_WINDOW, the swallowed auth.api.requestPasswordReset throw and the assessPassword gate are identical. Web's third implementation at apps/web/lib/account-actions.ts:246 is confirmed richer (identityForResetToken reading the Better Auth verification row plus a non-exported security-event/inbox writer). Size correction: only ~100 lines are actually removable from org+suppliers (211 total); web's copy carries ~60 lines of genuinely extra logic that an onReset callback would not delete, so 180 is high.

### `lib/auth.ts` — the same `AuthenticatedUser` + cached session read — is copied into all three apps

**Redundancy** · ~110 lines · confidence: high

Sites:

- `apps/web/lib/auth.ts:10`
- `apps/org/lib/auth.ts:9`
- `apps/suppliers/lib/auth.ts:9`

The `AuthenticatedUser` interface, the `SessionUser` type, `toAuthenticatedUser`, and the `cache()`-wrapped `getAuthenticatedUser` are character-for-character the same in all three files; only doc prose differs, and web additionally has `getAuthenticatedUserOrRedirect`. This is the single entry point every session gate in the monorepo builds on, so having three copies means a change to how a session is read (a new field, a different failure mode, a cache-scope decision) has three landing sites. The `emailVerified` field in particular gates god bootstrap and its doc comment is duplicated verbatim in web and org but shortened in suppliers — the drift has already started.

**Evidence.** Reading all three files in full: identical bodies for lines 9-57 (org/suppliers) and 10-60 (web). `grep -n` confirms the same four symbols at web:10/18/25/50, org:9/17/24/47, suppliers:9/17/24/47.

**Fix.** Move `AuthenticatedUser`, `SessionUser` and `toAuthenticatedUser` into `packages/auth` as `resolveAuthenticatedUser(headers: Headers)` — the file `packages/auth/src/account.ts` already takes `Headers` explicitly precisely to avoid a Next dependency, so this fits the existing seam. Each app's `lib/auth.ts` shrinks to a `cache(async () => resolveAuthenticatedUser(await headers()))` wrapper.

> **Verifier.** Confirmed exactly, including every line number: AuthenticatedUser/SessionUser/toAuthenticatedUser/getAuthenticatedUser at web:10/18/25/50, org:9/17/24/47, suppliers:9/17/24/47. diff org vs suppliers is three doc-prose hunks and nothing else — including the drift claim: org keeps '/\*_ Whether the auth provider has verified `primaryEmail`. Gates god bootstrap. _/' and suppliers has shortened it to drop 'Gates god bootstrap.'. diff web vs org is doc prose plus web's extra `redirect` import and getAuthenticatedUserOrRedirect. Sizes 67/57/57 = 181, so ~110 removable is right. The proposed seam is real: packages/auth exports './account' (which does take Headers explicitly) and './env' as separate entrypoints.

### Three different answers to "what does an error boundary look like", in three different places

**Collaboration hazard** · ~110 lines · confidence: medium

Sites:

- `apps/web/components/boundary/error-recovery.tsx:1`
- `apps/suppliers/components/error-recovery.tsx:1`
- `apps/org/app/error.tsx:1`
- `apps/org/app/global-error.tsx:1`

Web has `components/boundary/error-recovery.tsx` taking `{ error, reset, frame }` and doing its own `console.error`. Suppliers has `components/error-recovery.tsx` — different directory, different props (`{ reset, digest, homeHref, homeLabel }`, no `error`), and the logging moved out to the caller. Org has no component at all and inlines a fourth variant directly into both `app/error.tsx` and `app/global-error.tsx`, which are themselves near-copies of each other (same icon, same eyebrow, same Button, same digest line). A contributor fixing error-boundary copy has to find four different shapes in three conventions. The visual treatments genuinely differ per app brand, but the props contract and the file location need not.

**Evidence.** `diff -u apps/web/components/boundary/error-recovery.tsx apps/suppliers/components/error-recovery.tsx` → the whole file is rewritten; props overlap only on `title`/`description`. Read apps/org/app/error.tsx (57 lines, fully inline) and apps/org/app/global-error.tsx (60 lines, same markup again with `<html>/<body>` added). `packages/ui/src/components/` has no error-recovery entry.

**Fix.** One `ErrorRecovery` in `packages/ui` with `{ title, description, digest, reset?, actions? }` and the branded chrome supplied by the app's root layout (which is already how org's own comment says it works). Org's `error.tsx` and `global-error.tsx` then differ only by the `<html>/<body>` wrapper, which is the only thing Next actually requires them to differ by.

> **Verifier.** Confirmed on every checkable point. apps/web/components/boundary/error-recovery.tsx (81 lines) takes {error, reset, title, description, frame:'standalone'|'inline'} and does its own React.useEffect console.error. apps/suppliers/components/error-recovery.tsx (58 lines) sits in a different directory, takes {reset?, digest, title, description, homeHref, homeLabel}, has no `error` and no logging — the console.error moved out to apps/suppliers/app/error.tsx, which I read. apps/org has no such component: app/error.tsx (57 lines) inlines a fourth variant, and app/global-error.tsx (60 lines) is the same markup again — same TriangleAlert in bg-accent/15, same 'AFRIKABURN ORGANISER CONSOLE' eyebrow, same digest 'Reference:' line, same Button — with <html lang="en" className="dark org-accent">/<body> added, a stylesheet import, and two reworded copy strings. `ls packages/ui/src/components | grep -i error` returns only client-error-capture.tsx, so there is indeed no shared ErrorRecovery. 110 of 256 total lines is a fair estimate. The finding already concedes the visual treatments legitimately differ per brand, so this is not a taste complaint dressed as a hazard.

### The `users` join-row upsert plus re-animation guard is implemented three times in three session files

**Redundancy** · ~90 lines · confidence: high

Sites:

- `apps/web/lib/session.ts:126`
- `apps/org/lib/session.ts:149`
- `apps/suppliers/lib/session.ts:256`
- `apps/suppliers/lib/actions/register.ts:83`

Each app's session resolver opens with the same block: `insert(schema.users).onConflictDoNothing({ target: authUserId })`, then a select of `{ id, email, sanitizedAt }`, then `if (isSanitized(dbUser)) return <refuse>`, then a conditional email refresh guarded to run only after the sanitized check. The org and suppliers versions carry the same three explanatory comments nearly word for word ("Deliberately NOT onConflictDoUpdate…", "Re-animation guard…", "Keep the email fresh for a live account"). The three session gates themselves are genuinely different products and should stay separate — but this specific prologue is one invariant with three homes, and it is the invariant that stops a deleted-and-sanitized account being handed back its old memberships.

**Evidence.** Read apps/web/lib/session.ts:120-165, apps/org/lib/session.ts:143-180, apps/suppliers/lib/session.ts:250-280. `grep -rn isSanitized apps/*/lib` → web/session.ts:152, org/session.ts:167, suppliers/session.ts:273, plus a fourth open-coded use at suppliers/lib/actions/register.ts:97.

**Fix.** Extract `ensureLiveUserRow(db, authUser): Promise<{ id, email } | null>` into `packages/db` (or `packages/auth`), returning null for the sanitized case. Each session resolver calls it and then does its own app-specific gate work. The suppliers/register.ts copy at line 97 becomes the same call.

> **Verifier.** Confirmed for org<->suppliers, overstated for web. org/lib/session.ts:149-176 and suppliers/lib/session.ts:256-281 carry the prologue word for word, including all three comments verbatim ('Deliberately NOT onConflictDoUpdate...', 'Re-animation guard...', 'Keep the email fresh for a live account (never a sanitized one — guarded above)'). web/lib/session.ts:126-162 is the same INVARIANT but not the same code: it selects five columns (id, authUserId, email, username, sanitizedAt) not three, its comments are independently written, it returns null rather than a discriminated {kind}, and it mutates campUser.email in place before calling bootstrapGod. So the claimed 'same block ... a select of {id, email, sanitizedAt}' is wrong for web. The proposed `ensureLiveUserRow` returning `{id, email} | null` would also drop the `username` web needs, so the extraction needs a wider return than stated. The fourth open-coded use at suppliers/lib/actions/register.ts:83-97 is confirmed (it selects only id + sanitizedAt inside a tx). isSanitized consumers verified at web:152, org:167, suppliers:273, register:97.

### Boot-time config probes and the Better Auth client are triplicated verbatim

**Redundancy** · ~90 lines · confidence: high

Sites:

- `apps/web/lib/config.ts:12`
- `apps/org/lib/config.ts:10`
- `apps/suppliers/lib/config.ts:12`
- `apps/web/lib/auth-client.ts:23`
- `apps/org/lib/auth-client.ts:17`
- `apps/suppliers/lib/auth-client.ts:20`

`isAuthConfigured`, `isDatabaseConfigured` and `missingConfig` are identical in all three `lib/config.ts` — including the `missingConfig` string literals ("Better Auth (sign-in)", "Neon Postgres (database)"), which is what the env-less preview banner shows, so changing that wording means editing three files. `participantAppUrl()` with its `?? "http://localhost:3000"` fallback is duplicated between org and suppliers. `lib/auth-client.ts` is the same three-line `createAuthClient({ plugins: [twoFactorClient(), passkeyClient()] })` in all three apps, wrapped in 15-20 lines of near-identical comment; suppliers' comment already omits the `authClient.useListPasskeys()` note that web's carries, so the copies are drifting as documentation.

**Evidence.** Read all six files in full. `grep -n 'export function' apps/*/lib/config.ts` → the same three names in each, plus `participantAppUrl` at org:22 and suppliers:26 and `isFullyConfigured` only in web:20. `grep -n 'export const authClient'` → web:23, org:17, suppliers:20, all with the identical two-plugin body.

**Fix.** `packages/auth` already exports `./env` — put `isAuthConfigured`/`isDatabaseConfigured`/`missingConfig`/`participantAppUrl` there (they are plain `process.env` reads, client-safe, no `betterAuth()` construction). Export the configured browser client from `packages/auth` as a `./client` entry so the plugin list has one definition; apps re-export it.

> **Verifier.** Confirmed, with every cited line number exact. isAuthConfigured at web:12 / org:10 / suppliers:12; participantAppUrl at org:22 / suppliers:26; isFullyConfigured only at web:20; missingConfig at web:25 / org:27 / suppliers:31 and it produces NO diff hunk in either pairwise diff, so the 'Better Auth (sign-in)' / 'Neon Postgres (database)' literals really are three copies of one string list. authClient at web:23 / org:17 / suppliers:20, all three `createAuthClient({ plugins: [twoFactorClient(), passkeyClient()] })` with identical imports; suppliers' doc block does omit the useListPasskeys note web carries. The proposed seam checks out: packages/auth/package.json exports './env' -> src/env.ts, whose header states an explicit purity contract ('no I/O, no better-auth import, no side effects'), so moving the probes there does not drag betterAuth() into a client bundle. Note the counter-argument I looked for and did not find persuasive: web/lib/config.ts's own comment says the check is inlined 'so config stays a lightweight, client-safe module that does not pull the whole auth package in' — but @quagga/auth/env is already exactly that module, so the stated reason no longer requires a copy.

### `mark-all-read-button.tsx` exists three times and org's copy has already drifted behind the other two

**Redundancy** · ~60 lines · confidence: high

Sites:

- `apps/org/components/notifications/mark-all-read-button.tsx:17`

Web's and suppliers' copies are functionally identical — same `unreadCount` prop, same `disabled={pending || unreadCount === 0}`, same success toast ("All caught up"), same `router.refresh()` + `onDone()`; the diff is import path, comment, and statement ordering. Org's copy took a different fork: it accepts `disabled?: boolean` instead of `unreadCount: number`, and it shows NO success toast at all — only the error one. So the same button gives different feedback in the console than in the other two apps, and nobody chose that; it is the residue of the copy being made at a different time. This is exactly the drift the duplication produces.

**Evidence.** `diff -u apps/web/components/notifications/mark-all-read-button.tsx apps/suppliers/.../mark-all-read-button.tsx` → only import path, comment and if/else-vs-early-return reordering. `diff -u apps/org/... apps/suppliers/...` → prop rename `disabled`→`unreadCount` (org line 11/17) and the entire `toast.success("All caught up", …)` block present only in suppliers/web.

**Fix.** Move the button to `packages/ui` taking `unreadCount` and the action as props (the same injection the shared account cards already use). Org gets the success toast back as a side effect, which is the behaviour the other two apps and the house rule ("a 'saved' toast appears only after something was actually saved" — and, symmetrically, does appear) already imply.

> **Verifier.** Confirmed, including the drift. Files are 55/56/49 lines. diff web vs suppliers: only the action import path (@/lib/notifications-actions vs @/lib/actions/notifications), the comment, the className/disabled attribute ordering, and else-branch vs early-return — behaviourally identical, same `unreadCount` prop, same `disabled={pending || unreadCount === 0}`, same toast.success('All caught up'), same router.refresh() + onDone(). org's copy takes `disabled?: boolean` (line 17 in the type, line 13 in the destructure) instead of `unreadCount: number`, uses `disabled || pending`, and has NO toast.success at all — only toast.error. So the same button gives different feedback in the console than in the other two apps. 60 lines is if anything conservative against 160 total.

---

## apps/org — organiser console

_apps/org's lib/ and components/ trees are, on the whole, unusually well-reasoned: the queries.ts header (lines 71-97) states a real privacy invariant and the file mostly honours it, and several of the biggest files earn their size. I read lib/system-status.ts end to end expecting boilerplate and found the opposite — its twenty check functions are a catalogue of deployment prose, each one genuinely different, deriving its verdict from @quagga/auth and @quagga/db rather than restating policy; I have no finding there. Likewise components/questionnaires/questionnaire-preview.tsx and components/questionnaire/runner.tsx look like duplicates but are not: the preview is a throwaway walk with no validation or persistence, and both correctly delegate branching to @quagga/core. apps/org/components/gate-screen.tsx not using the @quagga/ui GateScreen primitive is documented in its own docstring (the shared quilt band would double up) — deliberate, not a finding. apps/org/lib/config.ts re-implementing isAuthConfigured is likewise documented as a client-safe inline. lib/god.ts is a thin env-reading shim over @quagga/core with a stated reason. I ran an exported-symbol sweep across the whole tree (grep each `export function|const|type|interface` name against apps/, packages/, e2e/, scripts/, docs/, excluding its own file) and confirmed there are no dynamic imports anywhere in apps/org, so static reachability is the whole story. Most of the "unreferenced" exports that sweep surfaced were interfaces used inside their own file — over-exported, but trivial, and I left them out. The real problems cluster in three places: the questionnaire component trees (a 542-line dead builder plus a directory split that has no rule), the auth/password surface (org and suppliers each carrying a full copy of logic and forms that packages/ui and @quagga/auth already have the pattern for), and lib/queries.ts, which is not so much a god-file as the one domain that never got the per-domain module treatment lib/questionnaires/ demonstrates. The single change with the best ratio is deleting components/questionnaire/builder.tsx; the one with the most leverage on future mistakes is deriving the registration contact-column omission from REGISTRATION_CONTACT_KEYS instead of hand-listing it twice._

### apps/org/components/questionnaire/builder.tsx (542 lines) is entirely dead — superseded by builder-v2 and imported by nothing

**Dead code** · ~542 lines · confidence: high

Sites:

- `apps/org/components/questionnaire/builder.tsx:1-542`

The file exports `QuestionnaireBuilder` (line 181), `questionToField` (line 84) and `BuilderInitial` (line 59). Nothing in the repo imports any of them. The two org pages that would use a builder — app/(console)/questionnaires/new/page.tsx:3 and app/(console)/questionnaires/[key]/edit/page.tsx:5 — both import `QuestionnaireBuilderV2` from components/questionnaires/builder-v2.tsx. apps/web has its own separate `QuestionnaireBuilder` (apps/web/components/questionnaire/builder.tsx:105) which is the one apps/web/app/(app)/camps/[slug]/questionnaires/new/page.tsx:22 uses. Worse than merely unused: it is a second, structurally weaker model of the same domain (flat single-page `BuilderField[]` with no sections, branching, content blocks or validation), sitting one directory away from the live one, so a newcomer grepping "questionnaire builder" in apps/org finds the wrong file first and may well extend it.

**Evidence.** `grep -rn "QuestionnaireBuilder" --include=*.ts --include=*.tsx --include=*.md .` (whole repo incl. e2e/, docs/, scripts/, _.test._): the only org hits are the declaration at builder.tsx:181 and the V2 declaration + its two page imports. `grep -rn "questionToField|BuilderInitial"` repo-wide: three hits, all inside builder.tsx itself. `grep -rn "dynamic\(|import\(" apps/org`: no dynamic imports anywhere in the app, so nothing loads it at runtime. Its only outbound dependency, `saveQuestionnaireDefinition`, is still live but reached via app/(console)/questionnaires/builder-actions.ts:14 instead.

**Fix.** Delete apps/org/components/questionnaire/builder.tsx. Nothing else changes; `saveQuestionnaireDefinition` keeps its live caller in builder-actions.ts.

> **Verifier.** Verified. `wc -l` = 542. Repo-wide grep for QuestionnaireBuilder/questionToField/BuilderInitial (incl. e2e/, docs/, scripts/, tests, packages) returns only the three declarations inside the file itself; the only other `QuestionnaireBuilder` is apps/web's own component used by apps/web/app/(app)/camps/[slug]/questionnaires/new/page.tsx:22, and the two org pages import QuestionnaireBuilderV2. No barrel/index file exists in apps/org/components. The only `import(` calls in apps/org are in lib/**tests**/email.test.ts and account-surface.test.ts — no dynamic load of this file. It is not a Next.js file-convention entrypoint (components/, not app/). Confirmed dead at the claimed size.

### org and suppliers each carry their own copy of the forgot-password and reset-password forms, differing only in copy, one route path and Tailwind classes

**Redundancy** · ~216 lines · confidence: high

Sites:

- `apps/org/components/auth/forgot-password-form.tsx:1-104`
- `apps/org/components/auth/reset-password-form.tsx:1-112`
- `apps/suppliers/components/auth/forgot-password-form.tsx:1-108`
- `apps/suppliers/components/auth/reset-password-form.tsx:1-114`

Read side by side, the two forgot-password forms have identical state, identical submit handling, identical enumeration-safe "confirmation replaces the form" structure and identical markup; the diff is the sign-in href (/auth/sign-in vs /signin), the email placeholder, one `required` prop and three `font-semibold tracking-tight` class additions. The reset forms are the same story: same token-missing screen, same single-field length-strength control, same `resetPassword` call, differing only in the redirect path and the same cosmetic class strings. This is not the repo's convention — packages/ui already owns the shared account UI (account-sessions.tsx, account-change-password.tsx, account-passkeys.tsx, account-shell.tsx, gate-screen.tsx), and apps/org/components/account/account-clients.tsx:10-19 consumes exactly that. These two forms are the outlier.

**Evidence.** `diff -u` on each pair: forgot-password produces 28 changed lines out of ~104, reset-password 20 out of ~112, and every one of them is copy, an href, or a class string — no branch, no handler, no validation differs. `ls packages/ui/src/components/` confirms there is no shared forgot/reset form despite eight `account-*` shared components sitting beside it.

**Fix.** Move both into packages/ui as `<ForgotPasswordForm signInHref emailPlaceholder onSubmit>` and `<ResetPasswordForm signInHref onSubmit>`, taking the app-specific action as a prop exactly as account-sessions.tsx already does. Each app then keeps a four-line call site.

> **Verifier.** Ran `diff -u` on both pairs. Forgot-password: differences are the header comment, /auth/sign-in vs /signin (×2), the email placeholder, one `required` prop, `font-semibold tracking-tight` additions, and text-accent vs text-primary. Reset-password: header comment, router.push path, and three `font-semibold tracking-tight` additions. No handler, branch, state or validation differs; the token-missing screen and the single-field strength control are identical. Sizes 104/112 (org) and 108/114 (suppliers), so the 216-line figure is accurate. `ls packages/ui/src/components/` confirms ~10 shared account-\* components and gate-screen.tsx but no shared forgot/reset form, so the outlier framing holds.

### Org questionnaire server actions live in two places, neither of them lib/actions/ where the other eleven domains keep theirs

**Collaboration hazard** · ~111 lines · confidence: high

Sites:

- `apps/org/lib/questionnaires/actions.ts:1`
- `apps/org/app/(console)/questionnaires/builder-actions.ts:1-111`
- `apps/org/lib/actions/`

Eleven `"use server"` modules sit in apps/org/lib/actions/ (account, accounts, bulletins, categories, notifications, org-roles, password, registrations, supplier-documents, suppliers, wranglers). Questionnaires break the pattern twice: their main action module is lib/questionnaires/actions.ts, and a second one — builder-actions.ts — is the only server-action file colocated under app/. The read side is inverted in the same way: every other domain's queries are jammed into the 2102-line lib/queries.ts while questionnaires get their own lib/questionnaires/queries.ts. So the codebase demonstrates the better layout for exactly one domain and the worse layout for eleven, and "where do org server actions live?" has three defensible answers.

**Evidence.** `grep -rln '"use server"' apps/org/app apps/org/lib` → 11 files under lib/actions/, plus lib/questionnaires/actions.ts and app/(console)/questionnaires/builder-actions.ts. `ls apps/org/lib` confirms lib/questionnaires/{actions,queries}.ts is the only per-domain module tree; everything else reads from lib/queries.ts.

**Fix.** Pick one shape and move to it. The cheap step is moving builder-actions.ts to lib/questionnaires/ so at least all server actions live under lib/; the better step is splitting lib/queries.ts into lib/<domain>/queries.ts modules mirroring lib/actions/, which the questionnaires directory already models.

> **Verifier.** Verified by grep -rln '"use server"' over apps/org/app and apps/org/lib: exactly 11 modules under lib/actions/ (account, accounts, bulletins, categories, notifications, org-roles, password, registrations, supplier-documents, suppliers, wranglers — result.ts is not a server module), plus lib/questionnaires/actions.ts and app/(console)/questionnaires/builder-actions.ts, which is indeed the only server-action file under app/. `ls apps/org/lib` confirms lib/questionnaires/ is the only per-domain directory; every other domain's reads sit in the 2102-line lib/queries.ts. builder-actions.ts is 111 lines and its header comment explains the validation gate but says nothing about why it lives under app/, and nothing in AGENTS.md/CONTRIBUTING.md/docs sanctions the placement. Not merely taste.

### apps/org/lib/actions/password.ts is a line-for-line copy of apps/suppliers/lib/actions/password.ts

**Redundancy** · ~100 lines · confidence: high

Sites:

- `apps/org/lib/actions/password.ts:1-111`
- `apps/suppliers/lib/actions/password.ts:1-100`

Both files implement the full self-hosted reset flow — the same Zod inputs, the same `isAuthConfigured() && RESEND_API_KEY` unavailability branch, the same `consumeRateLimit` call with the same key prefix and budget, the same `assessPassword` gate, the same `auth.api.requestPasswordReset` / `auth.api.resetPassword` calls and the same `enumerationSafeMessage` returns. `diff -u` between them produces exactly three substantive lines: a header comment, four JSDoc blocks the supplier copy dropped, and one error string ("Ask an administrator for help." vs "Contact AfrikaBurn for help."). Everything security-relevant — the enumeration-safety posture and the shared rate-limit bucket — is duplicated, so a fix to one is a fix to one.

**Evidence.** `diff -u apps/org/lib/actions/password.ts apps/suppliers/lib/actions/password.ts` — the complete diff is one comment block, four removed JSDoc comments, and the single error-string change quoted above. No logic line differs. Both are 100-111 lines.

**Fix.** Lift the pair into a shared module — the natural home is @quagga/auth (which already owns the `auth.api.*` seam and the env resolvers) or @quagga/core — parameterised by the one differing help sentence. apps/web/lib/account-actions.ts:246,378 is a third implementation of the same two actions and should be reconciled in the same pass.

> **Verifier.** Ran `diff -u` myself. The entire diff is: one header comment block, two removed JSDoc blocks, and the single error string "Ask an administrator for help." vs "Contact AfrikaBurn for help." Zero logic lines differ — same Zod inputs, same isAuthConfigured() gate, same consumeRateLimit, same assessPassword, same auth.api.\* calls, same enumeration-safe returns. Files are 111 and 100 lines. CORRECTION: the claim says "four JSDoc blocks the supplier copy dropped"; the diff shows two JSDoc blocks (11 lines). apps/web/lib/account-actions.ts:246/378 does hold a third implementation of requestPasswordReset/resetPassword as claimed.

### searchAccounts and getOrgAccessRoster copy-paste the same AccountRow select projection and row mapper

**Redundancy** · ~25 lines · confidence: high

Sites:

- `apps/org/lib/queries.ts:415-421`
- `apps/org/lib/queries.ts:469-480`
- `apps/org/lib/queries.ts:783-789`
- `apps/org/lib/queries.ts:807-818`

Both functions select the identical five-column shape including the conditional `...(personal ? { email: schema.users.email } : {})` spread, both then call `loadAssignedRoles`, and both build an `AccountRow` with a mapper body that is character-for-character the same across 11 lines (userId / the `"email" in r` cast / username / `orgRankFromRole` rank / `held.map(roleChip)` / `resolveAccountCapabilities(rank, held, actor.domains)` / createdAt). The docstring at lines 760-764 carefully explains why the two QUERIES must stay separate — and that reasoning is sound — but it says nothing about why the projection and the mapper are duplicated, which they need not be. The duplicated part is the privacy-sensitive part: the conditional email column and its unwrapping are the thing this file exists to get right, and it is written twice.

**Evidence.** Read apps/org/lib/queries.ts:414-421 against 782-789 (identical select object) and 468-480 against 806-818 (identical mapper body, only the surrounding `return`/`const members =` differs). Both are the only two producers of the exported `AccountRow` type declared at line 225.

**Fix.** Extract `accountRowSelect(personal: boolean)` returning the select object and `toAccountRow(row, held, actor)` returning the AccountRow, and have both queries call them. The two queries keep their genuinely different FROM/WHERE clauses and their separate docstrings.

> **Verifier.** Read both regions. The select objects at 415-421 and 783-789 are identical five-key shapes including the `...(personal ? { email: schema.users.email } : {})` spread (email spread confirmed at lines 420 and 788). Both call loadAssignedRoles with rows.map(r => r.userId), and the mapper bodies at 469-480 and 807-818 are character-identical (userId / `"email" in r` cast / username / orgRankFromRole / held.map(roleChip) / resolveAccountCapabilities(rank, held, actor.domains) / createdAt) — only `return rows.map` vs `const members = rows.map` differs. AccountRow is declared at line 225 and these two functions (391, 750) are its only producers. The docstring at 755-771 justifies keeping the queries separate but says nothing about the projection/mapper, exactly as claimed. ~25 duplicated lines is right.

### Three near-identical server-action result types and two different catch-wrappers in one app

**Redundancy** · ~25 lines · confidence: high

Sites:

- `apps/org/lib/actions/result.ts:4`
- `apps/org/lib/actions/result.ts:7-18`
- `apps/org/lib/actions/account.ts:39-40`
- `apps/org/lib/actions/account.ts:42-59`
- `apps/org/lib/actions/password.ts:20-21`

`AccountActionResult` (account.ts:39-40) and `PasswordActionResult` (password.ts:20-21) are the same type — `{ ok: true; message?: string } | { ok: false; error: string }` — declared twice under two names, and both are `ActionResult` (result.ts:4) plus an optional message. Alongside them sit two catch-wrappers that do the same job with different behaviour: the shared `runAction` (result.ts:7-18) and a private `run` in account.ts:41-58 which additionally calls `unstable_rethrow` and forwards a message. A reader cannot tell from the names which wrapper a new action should use, and the shared one is the one that does NOT rethrow Next's redirect signal — an inconsistency that is invisible until someone picks the wrong one.

**Evidence.** `grep -rn "ok: true; message?: string" apps packages` shows apps/org/lib/actions/{account,password}.ts declaring the identical union, plus the same shape again in apps/suppliers and packages/ui. `grep -rn "runAction|ActionResult" apps/org/lib` shows 11 action modules importing the shared pair while account.ts and password.ts define their own. Read result.ts:7-18 against account.ts:41-58 — same try/catch/message coercion, differing only in `unstable_rethrow(err)` and the `message` passthrough.

**Fix.** Widen `ActionResult` to `{ ok: true; message?: string } | { ok: false; error: string }`, delete both local aliases, and fold `unstable_rethrow` into the shared `runAction` so there is one wrapper with one behaviour.

> **Verifier.** Verified. result.ts:4 declares `ActionResult = {ok:true} | {ok:false;error:string}`; runAction is at 7-18. account.ts:39-40 and password.ts:20-21 each declare the identical `{ok:true;message?:string} | {ok:false;error:string}` union under two names, and neither file imports from ./result. The private `run` in account.ts is the same try/catch/message-coercion as runAction plus `unstable_rethrow(err)` and a message passthrough. Repo-wide grep confirms the same union recurs in apps/web/lib/account-actions.ts:75, apps/suppliers/lib/actions/{account,password}.ts and packages/ui account-sessions/account-change-password. CORRECTIONS: `run` spans 42-59, not 41-58; and 10 modules (not 11) actually import the shared runAction/ActionResult pair — account.ts and password.ts appear in that grep only because their own type names contain the substring. Note the proposed fix does change behaviour for those 10 callers (they would start rethrowing NEXT_REDIRECT) — that is the intended fix, not a regression.

### RegistrationStatusBadge is dead and duplicates the status→variant→label maps already exported by @quagga/ui

**Redundancy** · ~21 lines · confidence: high

Sites:

- `apps/org/components/status-badges.tsx:7-27`
- `packages/ui/src/components/status-badge.tsx:17-39`

`REGISTRATION_STYLE` (status-badges.tsx:7-18) maps all seven registration statuses to the same labels and the same Badge variants as `REGISTRATION_STATUS_VARIANT` + `REGISTRATION_STATUS_LABEL` in packages/ui (status-badge.tsx:17-39) — draft→outline/Draft, submitted→default/Submitted, under_review→default/"Under review", changes_requested→warning, approved→success, rejected→destructive, withdrawn→secondary. Every value matches. And the component built on it, `RegistrationStatusBadge`, has no callers: the org screens that render a registration status import the shared `StatusBadge` instead (registrations-table.tsx:8,45 and registration-review.tsx:11,129). So this is a second source of truth for a UI vocabulary the build-spec pins, kept alive by nothing.

**Evidence.** `grep -rn "RegistrationStatusBadge" --include=*.ts --include=*.tsx --include=*.md .` returns exactly one hit: the declaration at status-badges.tsx:20. Read both maps side by side — all fourteen entries agree. The sibling exports in the same file, `SupplierStandingBadge` (line 29) and `CohortBadge` (line 41), ARE used (registrations/[id]/page.tsx:43 and registrations-table.tsx:11) so the file itself stays.

**Fix.** Delete `REGISTRATION_STYLE` and `RegistrationStatusBadge` from apps/org/components/status-badges.tsx, keeping `SupplierStandingBadge` and `CohortBadge`.

> **Verifier.** Verified. REGISTRATION_STYLE at status-badges.tsx:7-18 and packages/ui/src/components/status-badge.tsx:17-39 agree on all seven statuses for both label and variant (draft/outline/Draft … withdrawn/secondary/Withdrawn). Repo-wide grep for RegistrationStatusBadge returns exactly one hit, the declaration at line 20 — no page, test, e2e spec or doc uses it. The siblings are genuinely live: CohortBadge imported at registrations-table.tsx:11 and SupplierStandingBadge at registrations/[id]/page.tsx:43, so the file survives the deletion as the finding says. Lines 7-27 is 21 lines.

### Eight copy-pasted revalidatePath blocks in lib/actions/org-roles.ts, already drifted into four variants

**Collaboration hazard** · ~18 lines · confidence: medium

Sites:

- `apps/org/lib/actions/org-roles.ts:139-141`
- `apps/org/lib/actions/org-roles.ts:199-200`
- `apps/org/lib/actions/org-roles.ts:251-253`
- `apps/org/lib/actions/org-roles.ts:348-353`
- `apps/org/lib/actions/org-roles.ts:437-439`
- `apps/org/lib/actions/org-roles.ts:526-529`
- `apps/org/lib/actions/org-roles.ts:576-578`
- `apps/org/lib/actions/org-roles.ts:659-660`

All eight actions in this file mutate the same three surfaces (/system/roles, /system, /accounts) and each ends by restating the revalidation list by hand. They have already diverged into four different sets: five actions use the full trio, two of those add "/", renameDepartment omits /accounts, and setAccountOrgRoles — the action that changes who holds which role, i.e. exactly what the /system/roles holder counts display — revalidates only /accounts and /system. Whether or not any individual omission currently matters, the shape is the problem: adding a ninth screen to this permission model means editing eight places and hoping.

**Evidence.** `grep -n "revalidatePath" apps/org/lib/actions/org-roles.ts` → 23 calls across the eight blocks cited; tallying them gives /system ×8, /system/roles ×7, /accounts ×7, / ×2. Read app/(console)/system/roles/page.tsx:107-112 to confirm the page renders `getOrgRoleImpacts` (per-role people counts), which setAccountOrgRoles at line 596 changes without revalidating that path.

**Fix.** Add one `function revalidateOrgRoleSurfaces()` in this file (or in lib/actions/result.ts) listing the paths once, and call it from all eight actions; keep the extra `revalidatePath("/")` explicit at the two sites that genuinely need the dashboard refreshed.

> **Verifier.** Verified against the file. Eight exported actions, each ending in a hand-written revalidation block at the cited lines, in four distinct variants: trio only (createDepartment, deleteDepartment, createOrgRole, deleteOrgRole), trio + "/" (setDepartmentDomains 348-353, updateOrgRole 526-529), /system/roles + /system only (renameDepartment 199-200), /accounts + /system only (setAccountOrgRoles 659-660). Tally: /system ×8, /system/roles ×7, /accounts ×7, "/" ×2. app/(console)/system/roles/page.tsx:107-112 does render getOrgRoleImpacts (per-role holder counts), which setAccountOrgRoles mutates without revalidating that path — so the omission is not hypothetical. CORRECTIONS: 24 revalidatePath calls, not 23; six actions use the full trio (two of them adding "/"), not five.

### block-editor.tsx defines the same id-allocation loop three times, and duplicates the CONTINUE sentinel with builder-v2

**Redundancy** · ~18 lines · confidence: high

Sites:

- `apps/org/components/questionnaires/block-editor.tsx:157-179`
- `apps/org/components/questionnaires/block-editor.tsx:56`
- `apps/org/components/questionnaires/builder-v2.tsx:90`

`allocateOptionValue` (157-163), `allocateRowId` (165-171) and `allocateColumnValue` (173-179) are the identical five-line algorithm — build a Set of taken values, start at length+1, increment while taken — differing only in which field they read and which prefix they emit. Separately, the Radix sentinel `const CONTINUE = "__continue__"` is declared at block-editor.tsx:56 and again at builder-v2.tsx:90; the two files are in the same directory, the second imports from the first, and both use it for the same "continue to the next section" branch value. Changing that magic string means changing it in two files with nothing linking them.

**Evidence.** Read block-editor.tsx:157-179 — three functions, same loop, differing in `o.value`/`r.id`/`c.value` and `option_`/`row_`/`col_`. `grep -rn "CONTINUE|__continue__" apps/org/components apps/org/lib apps/org/app` → two declarations (block-editor.tsx:56, builder-v2.tsx:90) and six uses split evenly between the two files.

**Fix.** Replace the three allocators with one `allocateKey(taken: readonly string[], prefix: string): string` called three times. Move `CONTINUE` into components/questionnaires/block-kinds.ts (already the shared module both files import) and export it.

> **Verifier.** Read the region: allocateOptionValue (158-163), allocateRowId (166-171), allocateColumnValue (174-179) are the same five-line Set/increment algorithm differing only in o.value/r.id/c.value and the option*/row*/col\_ prefix (docstrings at 157, 165, 173, so the cited 157-179 span is right). `const CONTINUE = "__continue__"` is declared twice — block-editor.tsx:56 and builder-v2.tsx:90 — with three uses each (830/835/847 and 831/835/846), same "continue to the next section" semantics. builder-v2.tsx:59 does import from ./block-editor, and both files import ./block-kinds (block-editor.tsx:43, builder-v2.tsx:70), so the proposed home for the sentinel is already a shared module of both.

### apps/org has two sibling directories, components/questionnaire/ and components/questionnaires/, split on nothing and cross-importing in both directions

**Collaboration hazard** · ~15 lines · confidence: high

Sites:

- `apps/org/components/questionnaire/`
- `apps/org/components/questionnaires/`
- `apps/org/components/questionnaires/results-view.tsx:33`
- `apps/org/components/questionnaires/builder-v2.tsx:77`
- `apps/org/components/questionnaires/questionnaire-preview.tsx:22-23`
- `apps/org/components/questionnaire/runner.tsx:51`

Fifteen questionnaire components live across two directories whose names differ by one letter. There is no rule separating them: the plural dir imports the singular one four times (results-view.tsx:33 → questionnaire/response-viewer; builder-v2.tsx:77 → questionnaire/blocking-badge; questionnaire-preview.tsx:22-23 → questionnaire/field + questionnaire/content-block) and the singular one's runner.tsx:51 documents itself against a file in the plural one. It is not an authoring-vs-filling split either: the dead v1 builder is in questionnaire/ while the live v2 builder is in questionnaires/, and the preview (authoring) sits in questionnaires/ while the runner (filling) sits in questionnaire/. apps/org is the only app with both — apps/web has only components/questionnaire/. The practical cost: every import needs a coin-flip, and a new component has no correct home.

**Evidence.** `ls -d apps/*/components/questionnaire*` → apps/org/components/questionnaire, apps/org/components/questionnaires, apps/web/components/questionnaire. `grep -rn "components/questionnaire/|components/questionnaires/" apps/org e2e docs scripts` shows the four plural→singular imports listed above plus the page-level imports; no import ever goes singular→plural. Read both trees: questionnaire/ holds activation-form, blocking-badge, builder (dead), close-activation-button, console-gate, content-block, field, response-viewer, runner; questionnaires/ holds block-editor, block-kinds, builder-v2, definition-issues, questionnaire-preview, results-view.

**Fix.** After deleting the dead builder.tsx, merge the two trees into one components/questionnaires/ (matching the route segment) — or, if a split is wanted, make it a real one (questionnaires/authoring/ vs questionnaires/filling/) and move runner.tsx/field.tsx accordingly. Note the "v2" name itself is spec-sanctioned (docs/questionnaire-spec.md:239 §"Builder v2 — Google Forms parity"), so keep it; it is the directory split, not the suffix, that misleads.

> **Verifier.** Substance verified, title overstated. `ls` confirms 9 files in questionnaire/ and 6 in questionnaires/ (15 total) and that apps/web has only the singular dir. The four plural→singular imports exist exactly as cited (results-view.tsx:33, builder-v2.tsx:77, questionnaire-preview.tsx:22-23). Nothing in AGENTS.md, CONTRIBUTING.md or docs/\*.md mentions either directory, so it is not a documented decision. CORRECTION: the title's "cross-importing in both directions" is wrong — every import goes plural→singular; runner.tsx:51 is only a comment reference. The claim body already says this, so the finding stands on its body, not its title. "Claimed size: 15 lines" is really 15 files, not lines.

### The conditional-column unwrap `"x" in r ? ((r.x as T) ?? null) : null` is hand-written nine times in lib/queries.ts, each with a type assertion

**Simplification** · ~15 lines · confidence: high

Sites:

- `apps/org/lib/queries.ts:473`
- `apps/org/lib/queries.ts:811`
- `apps/org/lib/queries.ts:1065-1068`
- `apps/org/lib/queries.ts:1310-1315`
- `apps/org/lib/queries.ts:1434`
- `apps/org/lib/queries.ts:1484`
- `apps/org/lib/queries.ts:1563`
- `apps/org/lib/queries.ts:1605`

Every query that conditionally selects a personal column has to unwrap it on the way out, and the idiom is retyped at each of nine sites, each carrying its own `as string | null` assertion to work around the union that the conditional spread produces. The result is nine casts in the one file whose entire premise is that these columns must be handled correctly, and the casts are exactly what a reviewer's eye slides over. A single generic helper — `function optional<T>(row: object, key: string): T | null` — would remove all nine assertions and make the pattern greppable by name instead of by shape.

**Evidence.** `grep -n '" in r' apps/org/lib/queries.ts` → 9 hits at the lines cited; read each: 473 and 811 are byte-identical, 1315 and 1563 differ only in the key name, 1063-1068 / 1309-1315 / 1484 / 1605 are the same shape spread over a few lines. AGENTS.md §Hard engineering rules 7 asks for strict TypeScript; these are the only assertions in the file.

**Fix.** Add one helper next to `seesPersonalInformation` (e.g. `function optionalColumn<T>(row: Record<string, unknown>, key: string): T | null`) and replace the nine sites with `optionalColumn<string>(r, "email")`. Behaviour is unchanged; nine `as` casts disappear.

> **Verifier.** Core claim verified: grep gives exactly nine sites at 473, 811, 1065-1068, 1310-1312, 1315, 1434, 1484, 1563, 1605, each carrying its own `as string | null` assertion; 473 and 811 are byte-identical. A single generic helper would preserve behaviour at all nine (1434 omits the `?? null` but the column is already string|null, so the result is unchanged). CORRECTION: the evidence sentence "these are the only assertions in the file" is false — queries.ts also has casts at 365 (`r.departmentId as string`), 965 (`as Record<...>`) and 1786 (`row.officerKey as OfficerKey`). That overstatement does not affect the finding itself.

### REGISTRATION_CONTACT_KEYS names the seven personal columns, but the code that actually drops them re-lists all seven by hand three lines later

**Collaboration hazard** · ~12 lines · confidence: high

Sites:

- `apps/org/lib/queries.ts:952-960`
- `apps/org/lib/queries.ts:963-965`
- `apps/org/lib/queries.ts:988-997`

Lines 952-960 declare `REGISTRATION_CONTACT_KEYS` with a comment explaining that these are the human-contact columns an unprivileged reader must never receive. But that constant is used for exactly one thing — building the null-spread at 963-965. The omission itself, at 988-997, is a hand-written destructure that repeats all seven names again as `_contactEmail`, `_altName`, `_altPhone`, `_altEmail`, `_lntName`, `_lntPhone`, `_lntEmail`. So the list exists in two places and only one of them enforces anything: add an eighth contact column, update the constant, and the column is still selected and shipped. The surrounding docstring (967-972) even advertises `getTableColumns` as the safeguard against a schema change silently changing behaviour, which is exactly the guarantee the hand-written destructure does not provide.

**Evidence.** Read apps/org/lib/queries.ts:947-1005 in full. `grep -n "REGISTRATION_CONTACT_KEYS" apps/org/lib/queries.ts` returns only lines 952, 964 and 965 — the constant never reaches the destructure at 988-997.

**Fix.** Drop the destructure and build the projection from the constant: `const cols = getTableColumns(schema.registrations); const withoutContact = Object.fromEntries(Object.entries(cols).filter(([k]) => !REGISTRATION_CONTACT_KEYS.includes(k as ...)));` — or keep the destructure and delete the constant, deriving the nulls from it. One list, one enforcement point.

> **Verifier.** Read 945-1005 in full. REGISTRATION_CONTACT_KEYS is at 952-960 (seven keys), REGISTRATION_CONTACT_NULLS at 963-965 is its only consumer, and the destructure at 988-997 hand-repeats all seven names as \_contactEmail/\_altName/\_altPhone/\_altEmail/\_lntName/\_lntPhone/\_lntEmail before `...withoutContact`. `grep -n REGISTRATION_CONTACT_KEYS` returns exactly lines 952, 964, 965 — the constant never reaches the omission. The docstring at 967-973 does advertise getTableColumns as the safeguard for schema changes, a guarantee the hand-written destructure does not extend to a newly added contact column. All line numbers as cited.

### unplacedIssues is an exported helper with no callers

**Dead code** · ~6 lines · confidence: high

Sites:

- `apps/org/components/questionnaires/definition-issues.tsx:83-88`

definition-issues.tsx exports five helpers for placing validator issues against the definition. Four are consumed — `issueLocation` and `issueBreadcrumb` inside the file, `sectionIssues` by builder-v2.tsx:73, `blockIssues`/`optionIssues` by block-editor. `unplacedIssues` is called by nothing, in this file or any other. It is the counterpart to `issueBreadcrumb`'s "Questionnaire" fallback (line 96), which is how root-level issues actually reach the UI, so it is a leftover of a design that was replaced rather than a hook for future use.

**Evidence.** `grep -rn "unplacedIssues" --include=*.ts --include=*.tsx --include=*.md .` (whole repo, incl. e2e/, docs/, scripts/, tests) returns exactly one hit: the declaration at definition-issues.tsx:84. Read the file end to end to confirm no internal call.

**Fix.** Delete lines 83-88.

> **Verifier.** Verified. Repo-wide grep (incl. e2e/, docs/, scripts/, tests) for unplacedIssues returns exactly two lines, both inside definition-issues.tsx: the declaration at 84 and its own body at 87. The sibling exports are genuinely live — sectionIssues via builder-v2.tsx:74/620, blockIssues and optionIssues via block-editor.tsx:44/210/918, issueLocation and issueBreadcrumb internally (issueBreadcrumb at 160). issueBreadcrumb's `if (loc.pageIndex === null) return "Questionnaire"` at line 96 is indeed the live path for root-level issues, so unplacedIssues is a superseded leftover. Deleting 83-88 (docstring + function) removes 6 lines with no other consumer.

---

## apps/web — participant app

_apps/web is in better shape than the raw line counts suggest — the "god-files" are mostly not the problem. `lib/roles-store.ts`, `lib/groups-store.ts` and `lib/questionnaire-store.ts` are large because they are honest domain-repository modules with dense, genuinely informative doc comments; they share a consistent shape (server-only, drizzle reads/writes, `{ ok: true } | { ok: false; error }` results, core predicates imported rather than reimplemented) and I found no case of the same query or rule implemented twice inside them. `components/questionnaire/field.tsx` is 945 lines but is one data-driven switch with `GridControl`, `ImageOption`, `OtherChoiceRow` and `OptionThumb` already extracted — not a candidate for splitting. The "\*-store.ts" convention is not a fresh reinvention per file: they are consistent enough that a shared base would add indirection without removing lines. What I did not check: `components/registration/registration-wizard.tsx` (939) and `lib/registration-store.ts` internals beyond their export surfaces, and the org/web `runner.tsx` pair (I confirmed they diverge substantially but did not verify whether the divergence is deliberate). The real damage is concentrated in two places. First, the mutant-vehicle/artwork feature pair, which was built by copy-paste at every layer — actions, edit pages, form chrome, the uploader — roughly 450 lines that would collapse to one parameterised implementation. Second, the app boundaries: `@quagga/auth/account` and `packages/ui` exist precisely to be the single copy, and apps/web quietly keeps private duplicates of things those packages already own (`recordSecurityEvent`, `BlockingBadge`, `ContentBlockView`, the questionnaire builder model) — in one case with the two copies already showing different text to different users. I also verified a small set of true dead code: two orphaned component files (one still receiving bug fixes), `requireOnboardedUser`, and `emptyBioExtrasState`. I checked but deliberately did not report: the ~35 `{ ok: false; error: string }` unions (idiomatic, and `@quagga/core` has no single Result type to unify on), the thin `listAccountSessions`/`listAccountPasskeys` per-app wrappers (documented as deliberate in packages/auth/src/account.ts — `next/headers` is a dependency that package refuses), the `CheckGroup`/`ChoiceGroup` near-pair in field-kit.tsx (real but shallow overlap), the four-times-repeated role-lookup preamble inside roles-store.ts (~20 lines, borderline), and several exported interfaces that are only used as return types._

### A 146-line image uploader plus the Section/Callout chrome is copy-pasted between the vehicle and artwork forms

**Redundancy** · ~190 lines · confidence: high

Sites:

- `apps/web/components/vehicles/vehicle-registration-form.tsx:74-264`
- `apps/web/components/artworks/artwork-registration-form.tsx:72-262`
- `apps/web/components/registration/field-kit.tsx:1-605`

`PhotoGrid` (vehicle-registration-form.tsx:119-264) and `ImageGrid` (artwork-registration-form.tsx:117-262) are byte-identical over 146 lines except the function name and the string "Add photo" vs "Add image" — the whole Blob-upload branch, the URL-paste fallback, the `MAX_LAYOUT_UPLOADS` cap, the remove buttons and the uploading spinner are duplicated. `Section` (vehicle:74-106 / artwork:72-104) and `Callout` (vehicle:109-116 / artwork:107-113) are identical bar one word in a doc comment. The two forms genuinely differ in their fields, which is fine; the shared chrome and the uploader are not field-specific at all, and `components/registration/field-kit.tsx` already exists as the home for exactly this kind of shared control.

**Evidence.** Extracted lines 119-264 of vehicle-registration-form.tsx and 117-262 of artwork-registration-form.tsx to files and diffed them: two hunks, `function PhotoGrid(`/`function ImageGrid(` and `"Add photo"`/`"Add image"`. Diffed lines 37-117 vs 37-115: the `Section` and `Callout` bodies are identical, only the doc comments and the interface field lists differ.

**Fix.** Move the uploader into `components/registration/field-kit.tsx` (or `@quagga/ui`) as one `<ImageUploadGrid itemNoun="photo" | "image" … />`, and move `Section` and `Callout` there too. Both forms then import them; ~200 lines disappear from the two 500-600 line files.

> **Verifier.** Extracted vehicle lines 119-264 and artwork lines 117-262 and diffed: exactly two hunks, `function PhotoGrid(` vs `function ImageGrid(` and "Add photo" vs "Add image". The whole Blob branch, URL-paste fallback, upload cap, remove buttons and spinner are byte-identical. Read Section (vehicle 74-106, artwork 72-104) and Callout (vehicle 109-116, artwork 107-113): bodies are character-for-character the same, only the doc comments differ (canvas ref S8ZcWf/Qq5u0 vs d3pOJI/H2DP4, "DMV rules" vs "safety + grant notes"). components/registration/field-kit.tsx (605 lines) exists and both forms already import from it (vehicle:26, artwork:23), so the proposed home is real, not invented. ~187 duplicated lines per file, claim of 200 is accurate.

### Mutant-vehicle and artwork registration actions are four near-identical files differing only in strings

**Redundancy** · ~170 lines · confidence: high

Sites:

- `apps/web/app/(app)/vehicles/new/actions.ts:1-78`
- `apps/web/app/(app)/artworks/new/actions.ts:1-78`
- `apps/web/app/(app)/vehicles/[slug]/edit/actions.ts:1-93`
- `apps/web/app/(app)/artworks/[slug]/edit/actions.ts:1-87`

The two create actions are line-for-line the same control flow: safeParse → requireCampUser → submit gate → getActiveEdition → checkCampName → warnings confirm → build payload → createProjectRegistration → map result. `diff vehicles/new/actions.ts artworks/new/actions.ts` produces only 11 hunks, every one of them a literal string, a comment, or a symbol name (`vehicleSubmitGate` vs `artworkSubmitGate`, `"mutant_vehicle"` vs `"artwork"`). The edit pair is the same story with `getProjectRegistrationForEdit` + `PROJECT_ADMIN_ROLES` + `updateProjectRegistration`. Two project kinds already share one store (`project-registration-store.ts`) and one result type; only the action shell was copied. A third project kind means a third copy, and a fix to the warning/gate ordering has to be made in two (or four) places.

**Evidence.** Ran `diff apps/web/app/(app)/vehicles/new/actions.ts apps/web/app/(app)/artworks/new/actions.ts` — every hunk is a message string, a comment block, or a renamed import. Ran `diff -u` on the two `[slug]/edit/actions.ts` files — same result: the only structural difference is artwork collapsing a 4-line return to 1 line. Both pairs already import the identical set of helpers (`requireCampUser`, `getActiveEdition`, `checkCampName`, `createProjectRegistration` / `updateProjectRegistration`).

**Fix.** Extract one `createProjectRegistrationAction(kind, spec)` and one `updateProjectRegistrationAction(kind, spec)` into a shared module (e.g. `apps/web/lib/project-registration-actions.ts`), parameterised by a small per-kind descriptor: `{ schema, submitGate, buildPayload, invalidMessage, nameTakenMessage, missingMessage }`. Each route's `actions.ts` shrinks to a `"use server"` file that binds the descriptor and re-exports the two actions.

> **Verifier.** Ran the diffs myself. `diff -u apps/web/app/(app)/vehicles/new/actions.ts apps/web/app/(app)/artworks/new/actions.ts` produces only hunks that are comments, message strings, or renamed symbols (VehicleRegistrationInput/vehicleSubmitGate/buildVehiclePayload vs the artwork equivalents, "mutant_vehicle" vs "artwork"). Control flow is identical: safeParse -> requireCampUser -> submit gate -> getActiveEdition -> checkCampName -> warnings confirm -> buildPayload -> createProjectRegistration. The edit pair is the same, with the only structural difference being artwork collapsing a 4-line return to one line. Both pairs import the same helpers from the same shared store. Files are 78/78/93/87 = 336 lines total, so a claimed ~170 removable lines is well within range.

### Two orphaned component files with zero consumers — one of them was still being edited a month after it was superseded

**Dead code** · ~84 lines · confidence: high

Sites:

- `apps/web/components/account/change-password-form.tsx:1-24`
- `apps/web/components/privacy-form.tsx:1-60`

`ChangePasswordForm` wires `AccountChangePassword` from `@quagga/ui` to `changePassword` from `lib/account-actions`. Nothing imports it: the live path is `components/account/sign-in-methods.tsx:39`, which passes `onChangePassword={changePassword}` into the shared `AccountSignInMethods`, which renders `AccountChangePassword` itself (packages/ui/src/components/account-sign-in-methods.tsx:159). Worse, the dead file was last modified by commit fbd6b9b ("hand back the session cookie a password change rotates", 2026-07-31) — a real fix applied to a file that runs nowhere, while the live `sign-in-methods.tsx` was only touched later. `PrivacyForm` is a 60-line save-and-toast wrapper around `PrivacyToggles`; `PrivacyToggles` itself is alive (used by questionnaire/runner.tsx:26 and onboarding/bio-flow.tsx:41), but nothing imports `PrivacyForm`, and `/profile` saves privacy through `savePrivacyFlagsAction` (app/(app)/profile/actions.ts:44) instead.

**Evidence.** `grep -rn "PrivacyForm\|privacy-form" apps packages e2e docs scripts` returns only the three self-references inside privacy-form.tsx. `grep -rn "ChangePasswordForm\|change-password-form"` likewise returns only its own definition. Traced the live wiring with `grep -rn "AccountChangePassword|changePassword"`: apps/web/components/account/sign-in-methods.tsx:39 and packages/ui/src/components/account-sign-in-methods.tsx:159. `git log -1 --format=%ci` on change-password-form.tsx → 2026-07-31 (commit fbd6b9b); on sign-in-methods.tsx → 2026-08-04.

**Fix.** Delete both files. If the /profile privacy panel is meant to have an explicit Save, wire `PrivacyForm` in — but as it stands it is unreferenced code that has already absorbed maintenance effort meant for the live path.

> **Verifier.** Grepped both symbols and both filenames across the whole repo (apps, packages, e2e, docs, scripts, _.test._, _.md, _.json, excluding node_modules): the only hits are the self-references inside the two files themselves — change-password-form.tsx:13 and privacy-form.tsx:10/19/23. Neither is a Next.js file-convention entrypoint (they are components/, not page/layout/route), and neither is re-exported through a barrel. The live path is as described: apps/web/components/account/sign-in-methods.tsx passes onChangePassword into the shared AccountSignInMethods, and PrivacyToggles is separately alive. git log confirms change-password-form.tsx was last touched by fbd6b9b on 2026-07-31 ("hand back the session cookie a password change rotates") while sign-in-methods.tsx was touched later on 2026-08-04. Sizes exact: 24 + 60 = 84 lines.

### `BlockingBadge` and `ContentBlockView` are duplicated web/org, and the blocking badge's two copies say different things while both comments claim one uniform treatment

**Collaboration hazard** · ~70 lines · confidence: high

Sites:

- `apps/web/components/questionnaire/blocking-badge.tsx:1-30`
- `apps/org/components/questionnaire/blocking-badge.tsx:1-26`
- `apps/web/components/questionnaire/content-block.tsx:1-44`
- `apps/org/components/questionnaire/content-block.tsx:1-49`

Two files named `blocking-badge.tsx` export a `BlockingBadge` doing the same job, and they have already drifted: web renders "Required · blocks until done" (blocking-badge.tsx:15) while org renders "Required — blocks the app until done" (org blocking-badge.tsx:15). The web copy's comment says "This one badge is reused on pending cards, list rows, the fill page, and the author's views so the treatment is identical across every surface" — which is untrue the moment an author sees the org wording and a burner sees the web wording for the same activation. AGENTS.md makes this a product law ("Blocking questionnaires are labeled explicitly everywhere"). `ContentBlockView` is the same duplication without the drift: the two files differ only in comments and one comment-only edit to the `<img>` note. CONTRIBUTING.md names `packages/ui` as "shared components — used by all three", so this is not a documented convention.

**Evidence.** `diff -u apps/web/components/questionnaire/blocking-badge.tsx apps/org/components/questionnaire/blocking-badge.tsx` — the badge text differs, and web takes a `className` prop the org copy replaced with a hardcoded `"gap-1"`. `diff -u` on the two `content-block.tsx` files: 12 diff lines, all of them comment text; both `ContentBlockView` bodies render the same info_block/image markup. Checked CONTRIBUTING.md:44-56 for a documented "apps don't share components" rule — the opposite is stated.

**Fix.** Move both components into `packages/ui/src/components/` (they take only `blocking: boolean` and `block: ContentBlock`, so neither has an app dependency) and delete the four app-local files. Pick one blocking-badge wording and let the shared component be the single place it lives.

> **Verifier.** Diffed both pairs. The badge drift is real: web renders "Required · blocks until done" and org renders "Required — blocks the app until done", and web takes a `className` prop the org copy hardcodes to "gap-1". Both copies are live (web: builder.tsx:555, pending-questionnaires.tsx:64, three page.tsx; org: activation-form.tsx:302, console-gate.tsx:41, builder-v2.tsx:941, two page.tsx), so a burner and an author genuinely see different wording for the same activation. AGENTS.md:202 does state "Blocking questionnaires are labeled explicitly everywhere and gate hard", so this is a documented product law being undermined, not taste. content-block.tsx differs only in comment text. CONTRIBUTING.md:44-56 lists packages/ui as "shared components — used by all three" with no rule against sharing; both copies already import from @quagga/ui, so neither has an app-only dependency.

### The answer-coercion helpers and the whole page preamble are duplicated between the two project edit pages

**Redundancy** · ~55 lines · confidence: high

Sites:

- `apps/web/app/(app)/artworks/[slug]/edit/page.tsx:31-53`
- `apps/web/app/(app)/vehicles/[slug]/edit/page.tsx:32-49`

`asString`, `asStringArray` and `asBoolOrNull` are declared identically in both edit pages (artwork additionally has `asNumberOrNull`), and the surrounding page body — auth check, `isDatabaseConfigured` → `PreviewNotice`, `ensureCampUser` → `PreviewNotice`, `pendingBlockingRoute` → redirect, `getActiveEdition` → `PreviewNotice`, `getProjectRegistrationForEdit` → `notFound`, role check — is the same sequence in the same order with only the kind literal and the `feature=` copy changing. These are the canonical coercions for reading a `QuestionnaireResponses` payload back into form state, so they belong next to `getProjectRegistrationAnswers` in the store, not copied per route.

**Evidence.** `grep -rn "function asString\|function asStringArray\|function asBoolOrNull\|function asNumberOrNull" apps/web` returns hits only in these two files (artwork lines 31/35/43/49, vehicle lines 32/36/44). `diff -u` on the two page files is 116 lines, and every hunk in the preamble region is a kind literal (`"artwork"` vs `"mutant_vehicle"`) or a `PreviewNotice feature` string.

**Fix.** Move `asString`/`asStringArray`/`asBoolOrNull`/`asNumberOrNull` into `apps/web/lib/project-registration-store.ts` beside `getProjectRegistrationAnswers` and export them. Optionally factor the shared preamble into one `loadProjectEditPage(slug, kind, featureLabel)` returning either a `PreviewNotice` marker or the resolved context.

> **Verifier.** Confirmed. `grep -rn "function asString|asStringArray|asBoolOrNull|asNumberOrNull" apps/web packages` returns only artwork edit page lines 31/35/43/49 and vehicle edit page lines 32/36/44 (plus an unrelated `asString(v: unknown)` in packages/core/src/bio.ts with a different signature). The bodies are identical. I read both page preambles: getAuthenticatedUser -> redirect, isDatabaseConfigured -> PreviewNotice, ensureCampUser -> PreviewNotice, pendingBlockingRoute -> redirect, getActiveEdition -> PreviewNotice, getProjectRegistrationForEdit -> notFound, PROJECT_ADMIN_ROLES -> redirect — same calls, same order, differing only in the kind literal and the PreviewNotice feature string. `diff` on the two files is 116 lines across 187/180-line files.

### Route-level actions each re-derive the group and re-implement the permission preamble; `groupIdForSlug` exists verbatim in two files and inline in two more

**Redundancy** · ~45 lines · confidence: high

Sites:

- `apps/web/app/(app)/camps/[slug]/actions.ts:37-64`
- `apps/web/app/(app)/camps/[slug]/questionnaires/actions.ts:14-21`
- `apps/web/app/(app)/camps/[slug]/settings/roles/actions.ts:41-52`
- `apps/web/app/(app)/camps/[slug]/registration/actions.ts:177-195`

`async function groupIdForSlug(slug)` — the same five-line select on `schema.groups.slug` — is declared privately in `camps/[slug]/actions.ts:37` and again in `camps/[slug]/questionnaires/actions.ts:14`, and written inline in `settings/roles/actions.ts:41-47` and `registration/actions.ts:177-182`. `camps/[slug]/actions.ts:50-64` then wraps it in a well-documented `requirePermission(slug, permission)` ("The single authz gate the role/officer actions share") — but that helper is file-private, so `settings/roles/actions.ts:49-52` reimplements exactly the same three steps (`getMemberPermissions` → `hasProjectPermission` → "You don't have permission to do that.") for `manage_roles`. Four route files, four spellings of one lookup and two spellings of one authz gate; a fifth route action author has no obvious place to reuse and will write a fifth.

**Evidence.** `grep -rn "eq(schema.groups.slug" apps/web` → 8 hits, 4 of them in route `actions.ts` files. `grep -rn "async function groupIdForSlug" apps/web` → camps/[slug]/actions.ts:37 and camps/[slug]/questionnaires/actions.ts:14, identical bodies. Read settings/roles/actions.ts:40-52 and camps/[slug]/actions.ts:50-64 — same query, same `getMemberPermissions`+`hasProjectPermission` check, same error string.

**Fix.** Move `groupIdForSlug` and `requirePermission` into `apps/web/lib/groups-store.ts` (or a small `lib/camp-guards.ts`) and have all four route action files import them. `settings/roles/actions.ts` then opens with `const gate = await requirePermission(slug, "manage_roles")`.

> **Verifier.** Read all four files. `async function groupIdForSlug` is declared at camps/[slug]/actions.ts:37 and camps/[slug]/questionnaires/actions.ts:14 with byte-identical five-line bodies. settings/roles/actions.ts:41-47 writes the same select inline, then 49-52 reimplements requirePermission's exact three steps (getMemberPermissions -> hasProjectPermission -> "You don't have permission to do that.") for "manage_roles" — same error string as camps/[slug]/actions.ts:61. registration/actions.ts:177-182 writes the lookup inline too (it selects name as well, and its authz is a different PROJECT_ADMIN_ROLES membership check — but the finding only claims the _lookup_ is inline there, which is accurate). requirePermission at camps/[slug]/actions.ts:50-64 is file-private, so it is genuinely unreachable from the other routes.

### apps/web hand-rolls `recordSecurityEvent` while org and suppliers import the shared copy written to prevent exactly that

**Redundancy** · ~25 lines · confidence: high

Sites:

- `apps/web/lib/account-actions.ts:107-131`
- `packages/auth/src/account.ts:219-234`
- `apps/org/lib/actions/account.ts:14`
- `apps/suppliers/lib/actions/account.ts:14`

`packages/auth/src/account.ts` exists specifically so the three apps share the account-security layer — its header says the functions "lived in `apps/web/lib/account.ts` while the participant app was the only door; org and suppliers are doors too, and three copies of a security read is how the three drift apart. One copy, here." `recordSecurityEvent` is exported at line 218 and imported by `apps/org/lib/actions/account.ts:14` and `apps/suppliers/lib/actions/account.ts:14`. But `apps/web/lib/account-actions.ts:115` declares its own private `recordSecurityEvent` with the same body — same `x-forwarded-for` split, same `x-real-ip` fallback, same `user-agent`, same swallowed catch, same insert into `schema.securityEvents` — and calls it from eight sites. The app that motivated the extraction is the one app not using it, so the module's own stated invariant is already false.

**Evidence.** `grep -rn recordSecurityEvent` across the repo: org and suppliers import from `@quagga/auth/account`; apps/web declares a local `async function recordSecurityEvent` at account-actions.ts:115 and calls it at lines 221, 364, 437, 458, 560, 677, 835, 995. Read both bodies side by side (packages/auth/src/account.ts:218-232 vs apps/web/lib/account-actions.ts:115-131): identical logic, the only difference being that the shared one takes `headers: Headers` as a parameter (deliberately, per the "framework-free on purpose" note) while the local one calls `await headers()` itself.

**Fix.** Delete apps/web/lib/account-actions.ts:107-131 and import `recordSecurityEvent` from `@quagga/auth/account`, passing `await headers()` at each of the eight call sites (or wrap it once locally in a 3-line `logSecurity(userId, kind)`).

> **Verifier.** Verified all of it. `grep -rn recordSecurityEvent` shows apps/org/lib/actions/account.ts:14 and apps/suppliers/lib/actions/account.ts:14 importing from @quagga/auth/account, while apps/web/lib/account-actions.ts:115 declares a private copy called at 221, 364, 437, 458, 560, 677, 835, 995 (eight sites, as claimed). Bodies compared side by side: same x-forwarded-for split, same x-real-ip fallback, same user-agent read, same swallowed catch, same insert into schema.securityEvents. I checked the one thing that could have refuted this — the shared copy uses `createHttpDb()` and the local one uses `db()` — but apps/web/lib/db.ts defines `export function db() { return createHttpDb(); }`, so they are the same client. The only real difference is the injected `Headers` parameter, exactly as claimed. Note the shared export is at line 219, not 218.

### The hard gate has three spellings in apps/web, one of which is dead code

**Collaboration hazard** · ~25 lines · confidence: high

Sites:

- `apps/web/lib/session.ts:247-264`
- `apps/web/app/(app)/artworks/new/page.tsx:30-32`
- `apps/web/app/(app)/vehicles/new/page.tsx:30-32`
- `apps/web/app/(app)/camps/new/page.tsx:25-27`
- `apps/web/app/(app)/artworks/[slug]/edit/page.tsx:100-101`
- `apps/web/app/(app)/vehicles/[slug]/edit/page.tsx:91-92`
- `apps/web/app/(app)/questionnaires/[activationId]/page.tsx:58-59`

`enforceGate(userId, currentPath?)` (session.ts:247-253) is documented as the one gate — "Every gated participant surface calls this" — and 10 pages do. Five other pages instead write `const gate = await pendingBlockingRoute(user.id); if (gate) redirect(gate);`, which is `enforceGate(user.id)` expanded by hand, and `(app)/questionnaires/[activationId]/page.tsx:58-59` hand-rolls the `currentPath` comparison that `enforceGate`'s second parameter exists for. On top of that, `requireOnboardedUser` (session.ts:260-264) packages `requireCampUser` + `enforceGate` and has zero callers anywhere in the repo, while its doc comment calls itself "the app-wide gate". A reader landing in session.ts sees three ways to do one job and no way to tell which is current.

**Evidence.** `grep -rn "enforceGate(" apps/web/app` → 10 call sites. `grep -rn "await pendingBlockingRoute" apps/web/app` → 11, of which 5 in `(app)/**/page.tsx` are the literal two-line expansion (read artworks/new/page.tsx:31-32 and camps/new/page.tsx:26-27 — identical, same comment "Onboarding (and any blocking questionnaire) gates everything else"). `grep -rn "requireOnboardedUser" .` across all .ts/.tsx/.md/.json outside node_modules returns exactly one hit: its own definition at apps/web/lib/session.ts:260.

**Fix.** Delete `requireOnboardedUser` (session.ts:255-264). Replace the five inline `pendingBlockingRoute` + `redirect` pairs with `await enforceGate(user.id)`, and the questionnaire fill page's variant with `await enforceGate(user.id, \`/questionnaires/${activationId}\`)`. One gate, one name.

> **Verifier.** All three legs check out. `enforceGate(` has exactly 10 call sites under apps/web/app (profile, notifications, camps/[slug]/registration, camps/[slug], settings/roles, three camps questionnaires pages, directory, bulletins/[id]). `await pendingBlockingRoute` has 11 hits under apps/web/app, of which five in (app)/\*\*/page.tsx are the literal two-line expansion — I read artworks/new:31-32, camps/new:26-27 (identical, same comment "Onboarding (and any blocking questionnaire) gates everything else"), vehicles/new:31-32, artworks/[slug]/edit:100-101, vehicles/[slug]/edit:91-92. questionnaires/[activationId]/page.tsx:58-59 hand-rolls `gate !== `/questionnaires/${activationId}``, which is precisely enforceGate's second parameter. `grep -rn requireOnboardedUser` across all .ts/.tsx/.md/.json outside node_modules returns one hit: its own definition at session.ts:260 — no test, no doc, no config string references it, and it is a plain exported function, not a Next.js file-convention entrypoint.

### `emptyBioExtrasState` is dead, duplicates `toBioExtrasState(null)`, and its doc comment describes a use that does not exist

**Dead code** · ~12 lines · confidence: high

Sites:

- `apps/web/components/questionnaire/burns-step.tsx:28-39`
- `apps/web/components/questionnaire/extras-state.ts:9-21`

`emptyBioExtrasState()` returns the seven-field empty `BioExtrasState`. `toBioExtrasState(undefined | null)` in extras-state.ts returns exactly the same object via its `??` defaults, and that is the function the two real callers use (`app/(app)/profile/page.tsx:33`, `app/(app)/onboarding/page.tsx:16`). Nothing anywhere imports `emptyBioExtrasState`. Its comment — "used when a bio has no v3 data yet" — states a caller that does not exist, which is the kind of comment that makes the next reader add a second empty-state path instead of using the one that works.

**Evidence.** `grep -rn "emptyBioExtrasState\|extras-state" apps/web --include=*.ts --include=*.tsx` returns three lines: the definition at burns-step.tsx:29, and the two `toBioExtrasState` imports in profile/page.tsx:33 and onboarding/page.tsx:16. Read both function bodies — field-for-field the same defaults (`about: ""`, `campHistory: []`, `volunteeringInterests: []`, `volunteeringOther: ""`, three booleans `false`).

**Fix.** Delete burns-step.tsx:28-39. Callers wanting a blank state call `toBioExtrasState(null)`.

> **Verifier.** Grepped emptyBioExtrasState across all .ts/.tsx outside node_modules: one hit, its own definition at burns-step.tsx:29. It is a plain exported helper, not a framework entrypoint, and no barrel re-exports it. Read both bodies: toBioExtrasState's `??` defaults produce exactly the same seven fields (about "", campHistory [], volunteeringInterests [], volunteeringOther "", rangerTraining/rangerCurious/greenDotTraining false) for a null or undefined argument, and that is what the two live callers use — profile/page.tsx:33/154 and onboarding/page.tsx:16/71. The doc comment "used when a bio has no v3 data yet" does describe a caller that does not exist. Size exact: burns-step.tsx:28-39 is 12 lines.

---

## packages/core and packages/types

_Overall these two packages are in better shape than their size suggests: the dependency rule (core depends only on types, no I/O, no env) holds — I grepped for `@quagga/db`, `next/`, `process.env` and React inside packages/core/src and found none outside the deliberate `./report-server` subpath, which correctly keeps `@anthropic-ai/sdk` out of the main barrel. Both barrels are complete and honest as export lists (every non-index .ts in packages/core/src has a matching `export *`; types/index.ts is 11 clean lines), `sideEffects: false` is set, and the per-module headers are unusually good. My export census — every `export const|function|class|type|interface|enum` in both packages, grepped repo-wide including e2e/, scripts/, docs/ and tests, then re-checked for in-file use — found only about a dozen genuinely dead runtime exports out of several hundred, which is a low rate. On (c), the questionnaire split: it is coherent by *layer* but not by *change*. The layering is defensible — types owns the 17 zod question schemas and per-answer validation (`validateOne`), core owns structural validation (questionnaire-definition), branching/progress (questionnaire-runtime), aggregation (questionnaire-results), required-action rows (questionnaire-activation) and authz — and each file's header explains its own boundary well. But no single document states that layering, and the vertical seam is bad: adding one question kind means editing packages/types/src/questionnaire.ts (schema + `Question` union + a `validateOne` arm), packages/core/src/questionnaire-runtime.ts (`hasAnswer`), packages/core/src/questionnaire-results.ts (its chart shape), apps/org/components/questionnaires/block-kinds.ts (palette entry, `createBlock`, `convertBlock`), apps/org/components/questionnaires/block-editor.tsx, and TWO separate renderers (apps/web/components/questionnaire/field.tsx at 945 lines and apps/org/components/questionnaire/field.tsx at 401) — I confirmed this by grepping the `"rating"` kind, which appears in exactly those files. A newcomer does not need to read all 764 lines of questionnaire.ts to change one thing, but they do need to find six files nothing points them at. Two adjacent smells I did not turn into findings because they sit outside packages/core and packages/types: apps/org carries both `components/questionnaire/` and `components/questionnaires/` directories, each with its own builder.tsx / field.tsx / runner.tsx, which is a naming trap waiting to bite; and `resolveActivationDefinition` (questionnaire-activation.ts:22) is a `??` behind a generic signature whose stated rationale ("so both apps and tests can call it without a @quagga/types dependency here") is false, since core depends on types everywhere — but it does have five real call sites and names a genuine rule (the snapshot is authoritative), so I left it. On the org-permissions ratio specifically: the 1096-line test is mostly buying real coverage — department scoping against a realistic ownership map, the lockout scenarios, the refusal copy, the medical-access crossover — and only about 40 lines are the same table stated a second and third time (reported above). The far bigger problem in that file is not the test at all, it is the doc comment that flatly contradicts the constant it sits on._

### The @quagga/core barrel's 145-line manifest advertises two functions that do not exist and that an org-app test forbids

**Collaboration hazard** · ~134 lines · confidence: high

Sites:

- `packages/core/src/index.ts:48`
- `apps/org/lib/__tests__/medical-audit-surface.test.ts:123`

index.ts opens with a 145-line "Landed:" manifest listing every module and its exports, before 50 lines of `export *`. Line 48-49 lists "medical audit READ side (the fail-open path's compensating control): summarizeMedicalAccess, detectMedicalEnumeration — distinct-subject" — the sentence is truncated, it is the only bullet with no `(./module)` pointer, and neither function exists anywhere in the repo. Worse, apps/org has a live regression test that asserts those exact names must NOT appear, recording a deliberate product decision ("reading many members' notes in one sitting is ordinary medic work, so flagging it reports normal care as an incident"). So the first file a newcomer to @quagga/core reads promises a feature the test suite actively prevents. The manifest as a whole is a second index that must be edited every time a module changes, with nothing enforcing it — this bullet is what that costs.

**Evidence.** `rg -n -w "summarizeMedicalAccess|detectMedicalEnumeration"` across the repo returns exactly two hits: packages/core/src/index.ts:49 and apps/org/lib/**tests**/medical-audit-surface.test.ts:123, where the assertion is `expect(stripComments(reader)).not.toMatch(/summarizeMedicalAccess|detectMedicalEnumeration|threshold|alert/i)`. `ls packages/core/src | grep -i medical` → only `medical-access.ts`. I also verified the barrel is otherwise complete: every non-index `.ts` in packages/core/src has a matching `export * from "./<name>"`, and neither the barrel nor `report.ts` pulls `@anthropic-ai/sdk` (that stays behind the `./report-server` subpath, as the header claims).

**Fix.** Delete the phantom bullet at index.ts:48-49. Then reduce the manifest to a module list with one-line purposes (or drop it in favour of the per-module headers, which are already good) — the current form duplicates every module's own doc comment and drifts silently.

> **Verifier.** index.ts:48-49 reads "medical audit READ side (the fail-open path's compensating control): summarizeMedicalAccess, detectMedicalEnumeration — distinct-subject" — truncated, and the only bullet in the section I read (lines 8-70) with no (./module) pointer. Repo-wide `rg -w` for those two names returns exactly two hits: that comment line and apps/org/lib/**tests**/medical-audit-surface.test.ts:123, whose assertion is `expect(stripComments(reader)).not.toMatch(/summarizeMedicalAccess|detectMedicalEnumeration|threshold|alert/i)` under a test titled "is a plain record — no aggregation, threshold or alerting" recording Ryan's 26 Jul 2026 product decision. Neither function is implemented anywhere. Manifest size: header runs lines 1-141 with `export *` starting at 143 (file is 194 lines), so ~134 not 145 — within tolerance.

### `org-roles.ts` re-implements `project-roles.ts`'s name-hygiene helpers verbatim, and one of the copies is dead

**Redundancy** · ~45 lines · confidence: high

Sites:

- `packages/core/src/org-roles.ts:69`
- `packages/core/src/org-roles.ts:74`
- `packages/core/src/org-roles.ts:78`
- `packages/core/src/org-roles.ts:88`
- `packages/core/src/org-roles.ts:105`
- `packages/core/src/project-roles.ts:88`
- `packages/core/src/project-roles.ts:93`
- `packages/core/src/project-roles.ts:98`
- `packages/core/src/project-roles.ts:113`

Five helper pairs are byte-identical modulo the identifier: `normalizeOrgName`/`normalizeRoleName` are both `return normalizeName(name);` (pure aliases of the same import from ./name-dedupe); `cleanOrgName`/`cleanRoleName` are both `name.trim().replace(/\s+/g, " ")`; `isValidDepartmentName`, `isValidOrgRoleName` and `isValidRoleName` share the same three-clause body differing only in a max constant that is 60 in all three cases; `orgNameConflicts` and `roleNameConflicts` have identical bodies including the `exceptNormalized` self-rename escape. `orgNameConflicts` (org-roles.ts:105) has zero consumers outside its own test — the org app never calls it — so it is a dead copy of a function that IS used. The org-roles.ts header explicitly says it is "the ORG SIDE of project-roles.ts, written to the same shape on purpose", which justifies the parallel vocabulary but not five copy-pasted bodies.

**Evidence.** Read org-roles.ts:60-119 and project-roles.ts:60-126 side by side. `rg -l -w orgNameConflicts` (excluding org-roles.ts/index.ts) → only packages/core/src/**tests**/org-roles.test.ts; `rg -l -w roleNameConflicts` → apps/web/lib/roles-store.ts plus its test. `rg -n "NAME_MAX"` shows ORG_DEPARTMENT_NAME_MAX=60 (org-roles.ts:52), ORG_ROLE_NAME_MAX=60 (org-roles.ts:55), PROJECT_ROLE_NAME_MAX=60 (project-roles.ts:73), and the first and third have no consumer outside their own file and test.

**Fix.** Move `cleanName(name)`, `isValidName(name, max)` and `nameConflicts(existing, candidate, exceptNormalized?)` into name-dedupe.ts alongside `normalizeName`. Have both org-roles.ts and project-roles.ts call them (keeping the domain-named wrappers only where an app already imports the name, and deleting `orgNameConflicts`, `normalizeOrgName` and `normalizeRoleName` — the latter two are pure aliases). Collapse the three identical 60s to one constant unless they are genuinely allowed to diverge.

> **Verifier.** Read org-roles.ts:60-119 and project-roles.ts:72-126 side by side. normalizeOrgName/normalizeRoleName are both `return normalizeName(name);`; cleanOrgName/cleanRoleName are both `name.trim().replace(/\s+/g, " ")`; isValidDepartmentName, isValidOrgRoleName and isValidRoleName have the identical three-clause body with maxes ORG_DEPARTMENT_NAME_MAX=60, ORG_ROLE_NAME_MAX=60, PROJECT_ROLE_NAME_MAX=60; orgNameConflicts and roleNameConflicts have byte-identical bodies including the exceptNormalized escape. Dead-copy claim confirmed: `rg -l -w orgNameConflicts` returns only org-roles.ts and packages/core/src/**tests**/org-roles.test.ts, while roleNameConflicts is live at apps/web/lib/roles-store.ts. ORG_DEPARTMENT_NAME_MAX and PROJECT_ROLE_NAME_MAX have no consumer outside their own file. One caveat on the fix, not the finding: normalizeOrgName IS imported by apps/org/lib/actions/org-roles.ts and normalizeRoleName by apps/web/lib/roles-store.ts, packages/db/src/schema.ts and apps/web/app/(app)/camps/[slug]/settings/roles/actions.ts, so those two cannot simply be deleted as the fix text suggests.

### The `DEPARTMENT_SCOPED_CAPABILITIES` doc comment says the exact opposite of the code below it

**Collaboration hazard** · ~35 lines · confidence: high

Sites:

- `packages/core/src/org-permissions.ts:239`
- `packages/core/src/org-permissions.ts:263`
- `packages/core/src/org-permissions.ts:271`
- `packages/core/src/org-permissions.ts:796`
- `docs/build-spec.md:228`

A 25-line doc comment (org-permissions.ts:239-262) declares "TWO, and they are the two that hurt" and lists `delete` and `read_personal_information`, then states "`read`/`write` are NOT here on purpose, and it is not an oversight to fix later". The declaration immediately underneath is `export const DEPARTMENT_SCOPED_CAPABILITIES: readonly OrgCapability[] = ORG_CAPABILITIES;` — i.e. all five. `isDepartmentScopedCapability` (line 271) is therefore a constant `true`. The comment also names capabilities that no longer exist in the vocabulary (`read_personal_information` is now `personal_information`; there is no `write`, it is `update`). The same false claim is repeated in `summarizeOrgActor`'s doc at line 797-799 and in docs/build-spec.md:228 ("TWO capabilities are department-scoped"). This is the single most authoritative-sounding comment in the repo's most security-sensitive file, and it is wrong in the direction that matters — someone reading it would believe a department-scoped `read` role reads the whole console, which the code refuses.

**Evidence.** Read org-permissions.ts:236-275 verbatim. The test at packages/core/src/**tests**/org-permissions.test.ts:465-483 is titled "scopes EVERY capability to the department, with no exceptions" and asserts `[...DEPARTMENT_SCOPED_CAPABILITIES].sort()` equals `[...ORG_CAPABILITIES].sort()` and `isDepartmentScopedCapability(c) === true` for every capability — so code and test agree with each other and disagree with the prose. `rg -n "read_personal_information|manage_accounts|read_system" packages/core/src/org-permissions.ts` returns 11 comment-only hits for capability names absent from `ORG_CAPABILITY_KEYS` (types/roles.ts:141-149 = create/read/update/delete/personal_information).

**Fix.** Rewrite the comment at 239-262 to say what the constant now is — every capability is department-scoped — keeping the historical note about why `read`/`update` used to be exempt as one clearly-past-tense sentence (the test at line 465 already contains that history and can be the source). Fix the stale capability names throughout the file's headers. Fix docs/build-spec.md:228 and the summarizeOrgActor doc at 797. Consider collapsing `DEPARTMENT_SCOPED_CAPABILITIES`/`isDepartmentScopedCapability` since they are now identity/`true`, or keep them with an honest one-line comment.

> **Verifier.** Read org-permissions.ts:239-275 verbatim. The comment says "TWO, and they are the two that hurt", lists `delete` and `read_personal_information`, and states "`read`/`write` are NOT here on purpose, and it is not an oversight to fix later". The declaration underneath is `export const DEPARTMENT_SCOPED_CAPABILITIES: readonly OrgCapability[] = ORG_CAPABILITIES;` — all five — making isDepartmentScopedCapability a constant true. Stale vocabulary confirmed: ORG_CAPABILITY_KEYS (types/roles.ts:141-147) is create/read/update/delete/personal_information; there is no `read_personal_information` and no `write`. The org-permissions.test.ts:465-483 test "scopes EVERY capability to the department, with no exceptions" asserts exactly the opposite of the prose. The repeat at summarizeOrgActor's doc (~org-permissions.ts:796-800: "narrows `delete` and `read_personal_information` and nothing else ... so a 'Suppliers member' whose role grants `read` reads the WHOLE console") and at docs/build-spec.md:228 ("**TWO capabilities are department-scoped**") both exist as claimed. Not taste; the comment is factually inverted in a security file.

### @quagga/types carries five kind-policy lists that duplicate the @quagga/core guards; three have no consumer at all

**Redundancy** · ~25 lines · confidence: high

Sites:

- `packages/types/src/roles.ts:225`
- `packages/types/src/roles.ts:233`
- `packages/types/src/roles.ts:100`
- `packages/types/src/roles.ts:103`
- `packages/types/src/roles.ts:128`
- `packages/core/src/project-roles.ts:222`
- `packages/core/src/project-roles.ts:227`
- `packages/core/src/org-roles.ts:174`
- `packages/core/src/org-roles.ts:187`
- `packages/core/src/org-roles.ts:191`

`UNDELETABLE_ROLE_KINDS`, `RENAMEABLE_ROLE_KINDS`, `UNDELETABLE_ORG_ROLE_KINDS`, `RENAMEABLE_ORG_ROLE_KINDS` and `UNDELETABLE_ORG_DEPARTMENT_KINDS` enumerate the same policy that the core guards decide independently — `canDeleteRoleKind` returns `kind === "custom"`, `canRenameRoleKind` returns `kind !== "officer"`, `canDeleteOrgRoleKind` returns `kind === "custom"`, `canRenameOrgRoleKind` returns `true`. Neither guard reads its list; the lists agree with the guards only because someone kept them in step by hand, and they will silently disagree the day a sixth `ProjectRoleKind` is added. `RENAMEABLE_ROLE_KINDS`, `UNDELETABLE_ROLE_KINDS` and `UNDELETABLE_ORG_DEPARTMENT_KINDS` are referenced nowhere at all outside their own declaration line (only in prose comments and docs), so they are two sources of truth where the second has no readers.

**Evidence.** `rg -n -w UNDELETABLE_ROLE_KINDS` across the whole repo returns 4 hits, all prose: docs/build-spec.md:161, packages/core/src/org-roles.ts:12 (a comment table), packages/types/src/roles.ts:74 (a comment) and roles.ts:225 (the declaration). Same shape for RENAMEABLE_ROLE_KINDS (declaration only) and UNDELETABLE_ORG_DEPARTMENT_KINDS (declaration only). `RENAMEABLE_ORG_ROLE_KINDS` and `UNDELETABLE_ORG_ROLE_KINDS` appear only in packages/core/src/**tests**/org-roles.test.ts:24-42, where the test asserts both the list contents AND the guard result for the same kinds. Read the guard bodies at project-roles.ts:222-229 and org-roles.ts:174-204 — none of them reference a list.

**Fix.** Delete the three lists with no readers. For the two the org-roles test uses, either derive them from the guards (`ORG_ROLE_KINDS.filter(canDeleteOrgRoleKind)`) or delete them and let the test assert the guard directly — one source of truth for "which kinds are permanent", in @quagga/core next to the guard that enforces it.

> **Verifier.** Read all five declarations (types/roles.ts:99-104, 127-130, 224-238) and all four guards (project-roles.ts:222-229 `kind === "custom"` / `kind !== "officer"`; org-roles.ts:174-176 `kind === "custom"`, org-roles.ts:191-193 `return true`, plus canDeleteOrgDepartmentKind at 187 `kind === "custom"`). None of the guards reads a list — the agreement is maintained by hand. Repo-wide greps confirm the reader census: UNDELETABLE_ROLE_KINDS has 4 hits, all prose/declaration (docs/build-spec.md:161, org-roles.ts:12 comment table, types/roles.ts:74 comment, and the declaration); RENAMEABLE_ROLE_KINDS and UNDELETABLE_ORG_DEPARTMENT_KINDS have declaration-only hits; UNDELETABLE_ORG_ROLE_KINDS and RENAMEABLE_ORG_ROLE_KINDS appear only in packages/core/src/**tests**/org-roles.test.ts:24-42. Line numbers are slightly off (guards are at org-roles.ts:174/187/191, not 174/187/192) but point at the right symbols.

### The code-questionnaire registry in `questionnaire-engine.ts` has zero consumers — apps call the builder directly

**Dead code** · ~25 lines · confidence: high

Sites:

- `packages/core/src/questionnaire-engine.ts:17`
- `packages/core/src/questionnaire-engine.ts:22`
- `packages/core/src/questionnaire-engine.ts:28`
- `packages/core/src/questionnaire-engine.ts:52`
- `packages/core/src/index.ts:62`

The module's stated purpose is to be "the CODE-SIDE registry that maps a key to its definition", and `CODE_QUESTIONNAIRES` / `getCodeQuestionnaire` / `isCodeQuestionnaire` implement it. Nothing anywhere resolves a questionnaire through it: apps/web/lib/bio-store.ts:225 calls `buildBurnerBioQuestionnaire()` directly, and everything else keys off `BURNER_BIO_ACTION_KEY` as a plain string. `hasPendingBlocker` is likewise unused (callers use `firstBlockingAction`, which IS live at apps/web/lib/session.ts:214). The indirection layer therefore adds a name and a `Record` lookup and buys nothing, while the barrel manifest at index.ts:62 advertises `getCodeQuestionnaire` as a landed capability. Only `BURNER_BIO_ACTION_KEY`, `firstBlockingAction`, `RequiredActionLike` and `isParticipantFacingActivation` are actually consumed.

**Evidence.** `rg -c -w getCodeQuestionnaire|isCodeQuestionnaire|hasPendingBlocker` across the repo (excluding index.ts, which only mentions getCodeQuestionnaire in a comment) returns exactly one hit each — the declaration in questionnaire-engine.ts. `rg -n -w BURNER_BIO_ACTION_KEY` shows apps/web/lib/{bio-store,required-actions,session}.ts and apps/org/lib/questionnaires/queries.ts using the constant directly. apps/web/lib/bio-store.ts:7,225 imports and calls `buildBurnerBioQuestionnaire` from @quagga/core, bypassing the registry. Only `isParticipantFacingActivation` is imported by questionnaire-engine.test.ts:3.

**Fix.** Delete `CODE_QUESTIONNAIRES`, `getCodeQuestionnaire`, `isCodeQuestionnaire` and `hasPendingBlocker`, drop the now-unused `buildBurnerBioQuestionnaire` and `Questionnaire` imports, and remove the getCodeQuestionnaire mention from index.ts:62. What remains (the action key, `firstBlockingAction`, `isParticipantFacingActivation`) is small enough to fold into a clearly-named `required-actions.ts`, since "questionnaire engine" now describes nothing the file does.

> **Verifier.** Repo-wide `rg -n -w` (including e2e/, scripts/, docs/, tests) returns for getCodeQuestionnaire only its declaration at questionnaire-engine.ts:22 plus the index.ts:62 comment mention; for isCodeQuestionnaire only questionnaire-engine.ts:28; for hasPendingBlocker only questionnaire-engine.ts:52. CODE_QUESTIONNAIRES (line 17) is referenced only by those two dead functions. apps/web/lib/bio-store.ts:7,225 imports and calls buildBurnerBioQuestionnaire directly, bypassing the registry, and BURNER_BIO_ACTION_KEY is consumed as a plain string in apps/web/lib/{bio-store,required-actions,session}.ts and apps/org/lib/questionnaires/queries.ts. firstBlockingAction is live (apps/web/lib/session.ts:214) and isParticipantFacingActivation is live in three app files, exactly as the finding says. No Next.js file-convention or string-config escape applies — this is a plain lib module.

### Seven more exports across core and types have no consumer outside their own declaration

**Dead code** · ~22 lines · confidence: high

Sites:

- `packages/core/src/questionnaire-authz.ts:100`
- `packages/core/src/registration-state.ts:85`
- `packages/core/src/account-security.ts:35`
- `packages/types/src/roles.ts:303`
- `packages/types/src/notifications.ts:28`
- `packages/types/src/payments.ts:26`
- `packages/types/src/groups.ts:19`

Each of these is exported through a barrel and read by nothing. `canManageProjectRoles` is a pure alias of `isProjectAdmin` with only a test importing it. `canCampReopen` is a state-machine predicate no caller asks. `PASSWORD_HELP_TEXT` is user-facing copy that no form renders — the risk being that the real form has its own copy and the two will diverge. `PROJECT_PERMISSION_LABELS` is a five-entry UI copy table in @quagga/types (labels in the _types_ package is already a layering smell) that no settings editor imports. `NOTIFICATION_KINDS`, `DEFAULT_CURRENCY` and `PROJECT_KINDS` are iteration/convenience constants with no readers; `PROJECT_KINDS` in particular duplicates `isProjectKind` (groups.ts:25), which does the same job as a predicate and IS the one the codebase uses.

**Evidence.** Ran a repo-wide census script extracting every `export const|function|class|type|interface|enum` from packages/core/src and packages/types/src and running `rg -l -w <symbol>` over the whole repo excluding the declaring file and node_modules (so e2e/, scripts/, docs/ and _.test._ were all included). These seven returned zero external files, and I then re-grepped each within its own file to confirm it is not used internally either — e.g. `rg -c -w PASSWORD_HELP_TEXT` → 1 hit total (account-security.ts:35); `rg -c -w PROJECT_PERMISSION_LABELS` → 1 hit (types/roles.ts:303); `rg -c -w canManageProjectRoles` → questionnaire-authz.ts:1 plus its test. I also confirmed the copy in PROJECT_PERMISSION_LABELS is not duplicated verbatim in an app (`rg -n "See member details|Send questionnaires"` finds no app hit).

**Fix.** Delete all seven. If `PASSWORD_HELP_TEXT` reflects the policy the real sign-up form states, wire the form to it instead of deleting; otherwise it is a promise nothing keeps. Replace any future need for `PROJECT_KINDS` with the existing `isProjectKind`.

> **Verifier.** Re-ran the census myself with repo-wide `rg -n -w` (no exclusions beyond node_modules) for all seven. canManageProjectRoles (questionnaire-authz.ts:100): declaration + questionnaire-authz.test.ts + an index.ts comment only, and its body is literally `return isProjectAdmin(memberships, groupId);`. canCampReopen (registration-state.ts:85): declaration only. PASSWORD_HELP_TEXT (account-security.ts:35): declaration only — and the divergence risk is already realised, since apps/suppliers/components/auth/sign-up-form.tsx:218 and packages/ui/src/components/account-change-password.tsx:114 each hand-write their own near-copy of the same sentence. PROJECT_PERMISSION_LABELS (types/roles.ts:303): declaration only. NOTIFICATION_KINDS (notifications.ts:28), DEFAULT_CURRENCY (payments.ts:26), PROJECT_KINDS (groups.ts:19): declaration only. One correction: the claim that isProjectKind "IS the one the codebase uses" is wrong — isProjectKind (groups.ts:26) is itself referenced only by packages/types/src/**tests**/enums.test.ts, so it is an eighth unused export rather than a live replacement. That does not disturb the seven-dead-exports claim.

### `flattenQuestions` (@quagga/types) and `allQuestions` (@quagga/core) are the same function under two names

**Redundancy** · ~12 lines · confidence: high

Sites:

- `packages/types/src/questionnaire.ts:485`
- `packages/core/src/questionnaire-runtime.ts:241`

Both walk `questionnaire.pages` and concatenate `pageQuestions(page)`. `flattenQuestions` adds an `if (page.kind === "questions")` guard that is a no-op, because `pageQuestions` (questionnaire.ts:494) already returns `[]` for any non-`questions` page. So the two are behaviourally identical, live in different packages, are both re-exported from their barrels, and have split the call sites between them: the four app-level consumers call `flattenQuestions`, while `questionnaire-results.ts` and `questionnaire-runtime.ts` internally call `allQuestions`. A newcomer counting questions has to guess which of two exported names is the right one, and the two names imply a difference (`all` vs `flatten`) that does not exist.

**Evidence.** Read both bodies. types/questionnaire.ts:485-491 is `for (const page of questionnaire.pages) { if (page.kind === "questions") out.push(...pageQuestions(page)); }`; core/questionnaire-runtime.ts:241-245 is `for (const page of questionnaire.pages) out.push(...pageQuestions(page));`. questionnaire.ts:494-497 shows `pageQuestions` returns `[]` unless `page.kind === "questions"`. `rg -n -w flattenQuestions` → apps/web/lib/questionnaire-store.ts:384, apps/web/components/questionnaire/response-viewer.tsx:51, apps/org/lib/questionnaires/queries.ts:87, apps/org/app/(console)/questionnaires/[key]/[activationId]/page.tsx:101, apps/org/components/questionnaire/response-viewer.tsx:57. `rg -n -w allQuestions` → only packages/core (questionnaire-results.ts:393, questionnaire-runtime.ts:213) plus tests.

**Fix.** Delete `allQuestions` from questionnaire-runtime.ts and have questionnaire-runtime.ts:213 and questionnaire-results.ts:393 import `flattenQuestions` from @quagga/types. Drop the dead `page.kind` guard in `flattenQuestions`. One name, one implementation, in the package that owns the question schema.

> **Verifier.** Verified both bodies. types/questionnaire.ts:485-491 loops pages with `if (page.kind === "questions") out.push(...pageQuestions(page))`; core/questionnaire-runtime.ts:241-245 loops pages with `out.push(...pageQuestions(page))`. pageQuestions (questionnaire.ts:494-497) returns [] unless page.kind === "questions", so the guard is genuinely a no-op and the two are behaviourally identical. Both are exported from their package barrels. Call-site split confirmed: flattenQuestions is used by five app files (not four as the prose says — apps/web/lib/questionnaire-store.ts:384, apps/web/components/questionnaire/response-viewer.tsx:51, apps/org/lib/questionnaires/queries.ts:87, apps/org/app/(console)/questionnaires/[key]/[activationId]/page.tsx:101, apps/org/components/questionnaire/response-viewer.tsx:57), allQuestions only inside packages/core (questionnaire-runtime.ts:213, questionnaire-results.ts:393) plus tests. Size ~12 lines is accurate.

### Two questionnaire response validators with overlapping names and no rule for which to call

**Collaboration hazard** · ~10 lines · confidence: high

Sites:

- `packages/types/src/questionnaire.ts:504`
- `packages/core/src/questionnaire-runtime.ts:186`
- `apps/web/lib/bio-store.ts:226`
- `apps/org/lib/questionnaires/actions.ts:615`
- `apps/web/lib/questionnaire-store.ts:727`

`validateResponses` (types) validates every question in the definition; `validateSubmission` (core) validates only the branch-resolved path. The difference is real and documented in `validateSubmission`'s header, but nothing at the `validateResponses` end warns a caller that using it on a branching Builder-v2 questionnaire will demand answers the respondent was never shown. The three live call sites are split without a stated rule: apps/web/lib/questionnaire-store.ts:727 uses `validateSubmission`, apps/org/lib/questionnaires/actions.ts:615 uses `validateResponses` on the same kind of activation definition, and apps/web/lib/bio-store.ts:226 uses `validateResponses` on the code-built bio (which is legitimately branchless). Two functions with near-identical names, in two packages, one of which is a strictly-safer superset of the other, is the shape a newcomer picks wrong.

**Evidence.** Read both bodies. types/questionnaire.ts:509-536 loops `questionnaire.pages` → `pageQuestions` → `validateOne`; core/questionnaire-runtime.ts:195-238 resolves the path from the raw answers first, then validates `visibleQuestions(...)` only. `rg -n -w validateResponses` → apps/web/lib/bio-store.ts:23,226 and apps/org/lib/questionnaires/actions.ts:24,615 (plus tests). `rg -n -w validateSubmission` → apps/web/lib/questionnaire-store.ts:14,727 only. `validateSubmission`'s doc comment at questionnaire-runtime.ts:186-193 explains the difference; `validateResponses`' doc at questionnaire.ts:504-508 does not mention branching or `validateSubmission` at all.

**Fix.** Add the reciprocal warning to `validateResponses`' doc comment naming `validateSubmission` and stating when each is correct, and rename them to say what they do (`validateAllQuestions` / `validateVisibleQuestions`). If org activations can branch, apps/org/lib/questionnaires/actions.ts:615 is calling the wrong one and should move to `validateSubmission`.

> **Verifier.** Verified both bodies and both doc comments. types/questionnaire.ts:504-536: the doc says only "Validate a response map against a questionnaire definition" with no mention of branching or of validateSubmission, and the loop walks every page's pageQuestions. core/questionnaire-runtime.ts:186-238: the doc does explain the difference, and the body resolves the path from raw answers then validates visibleQuestions only. Call sites confirmed and split as claimed: apps/web/lib/questionnaire-store.ts:727 validateSubmission; apps/org/lib/questionnaires/actions.ts:615 validateResponses; apps/web/lib/bio-store.ts:226 validateResponses. The org site is the substantive part — it validates `resolveActivationDefinition(activation.definition, def.definition)`, an ordinary Builder-v2 org_internal definition that can contain branches, against the all-questions validator, so a respondent who branched past a required question would be refused. Nothing in AGENTS.md or the surrounding comments documents a rule for which validator applies where.

---

## packages/ui, packages/db, packages/auth, config packages

_Overall these five packages are in good shape and unusually well documented — most of what looks odd on first read turns out to be a deliberate, explained decision, and I discarded several candidate findings on that basis. Specifically I checked and found CLEAN: packages/db/src/schema.ts, which despite 2045 lines is genuinely navigable (every table sits under a `// --- Section ---` banner, ~60 of them, enums grouped at the top — splitting it would cost more than it saves); packages/db/src/migrate.ts, local-proxy.ts and rate-limit.ts, each of which earns its place and carries a real incident in its header (the double-seeded suppliers, the 152ms HTTP-proxy penalty, better-auth's table-wide prune); packages/db/src/seed.ts, which pulls SOUND_SCALE, CANONICAL_CAMP_CATEGORIES, seededOrgRoleRows etc. from @quagga/core rather than restating them — slugify is the single exception; packages/auth/src/account.ts, where none of the exported functions is a bare forward to better-auth (each normalises a provider shape and degrades to [] rather than throwing, and listAccountSessions' cookie-cache decision is measured and justified); the toast system (50 call sites, one Toaster per app root layout, no competing implementation anywhere); and table.tsx vs responsive-data-table.tsx, which are a base primitive and a genuine composition of it, not rivals. I also verified that PaymentDetailsBlock, although it has zero consumers, is explicitly preserved by docs/build-spec.md:275 ("the payments table and PaymentDetailsBlock survive only for future logistics apps") and therefore reported it NOT as a finding. Two things too small to file: three packages/ui components import `cn` via the self-referencing specifier `@quagga/ui/lib/utils` (file-upload.tsx:13, account-shell.tsx:1, account-capability-notice.tsx:3) while the other ~40 use `../lib/utils`; and apps/suppliers/components/route-skeleton.tsx:48 re-exports the shared kit under aliases (`Skeleton as SkeletonBar, SkeletonCard as CardSkeleton`), so the same primitive has two names depending on which app you are reading. The real theme across my findings is packages/ui's shared-vs-local boundary: GateScreen and StatusBadge both have a shared version that an app quietly declined to use, and the notification panel is the shared component that was never extracted at all._

### notification-panel.tsx is maintained in triplicate across the three apps

**Redundancy** · ~200 lines · confidence: medium

Sites:

- `apps/web/components/notifications/notification-panel.tsx:1`
- `apps/org/components/notifications/notification-panel.tsx:1`
- `apps/suppliers/components/notifications/notification-panel.tsx:1`

The three panels (110, 105 and 106 lines) are the same component: same Popover-based non-modal shell, same `PANEL_CLASS` string, same lazy load-on-open via a server action, same empty/loading/list branches, same "All notifications →" footer. Diffing suppliers against org shows only the copy strings, the accent colour class and a comment differing; diffing web against org adds a `<li>` wrapper and an `unreadCount` vs `disabled` prop on the mark-all button. The three server actions are legitimately per-app (each scopes to its own inbox), but the presentation is not — packages/ui already owns `notification-bell.tsx` and `notification-item.tsx`, so the panel is the one piece of this feature that escaped the shared package. Any change to the panel's interaction now has to be made and reviewed three times, and the small gratuitous differences make it easy to fix a bug in two of them.

**Evidence.** Ran `diff apps/web/components/notifications/notification-panel.tsx apps/org/...` and `diff apps/suppliers/... apps/org/...`. The suppliers↔org diff is 6 hunks: two import lines, a comment paragraph, the items state type, `unreadCount={count}` vs `disabled={count === 0}`, the empty-state sentence, the `<ul>` divide class + row wrapper, and `text-primary` vs `text-accent`. Everything else — the Popover wiring, the load-on-open effect, the header, the footer link — is byte-identical.

**Fix.** Move the panel into packages/ui as a presentational `NotificationPanel` that takes `items`, `count`, an `onLoad: () => Promise<Item[]>` server-action prop, and the empty-state copy + accent class as props. Each app then passes its own action and wording. Normalise the NotificationRow prop shape (`item` object vs spread) while doing it so the three rows converge too.

> **Verifier.** Verified by running both diffs. Line counts are exactly 110 (web), 105 (org), 106 (suppliers). suppliers vs org: 7 small hunks — two import lines, the comment paragraph, the items state type (NotificationRowItem[] vs Omit<NotificationRowProps,'onOpen'>[]), unreadCount={count} vs disabled={count===0}, the empty-state sentence, the <ul> divide class + <li> row wrapper, and text-primary vs text-accent. web vs org is the same set plus the action import path. Everything else — 'use client', PANEL_CLASS, the Popover wiring, the lazy load-on-open effect, header, footer link — is byte-identical, exactly as claimed. packages/ui owns notification-bell.tsx and notification-item.tsx but no panel, confirming this is the one piece that escaped the shared package. 200 lines of removable duplication out of 321 total is a fair, non-inflated estimate. The per-app server actions really are per-app, and the proposed prop-based extraction preserves that.

### packages/ui ships four exported symbols no app has ever imported

**Dead code** · ~86 lines · confidence: high

Sites:

- `packages/ui/src/components/dismissible-pinned-bulletin-banner.tsx:22`
- `packages/ui/src/components/skeleton.tsx:153`
- `packages/ui/src/components/skeleton.tsx:179`
- `packages/ui/src/components/markdown-editor/markdown.ts:27`

Four exports in the shared UI package are reachable only from packages/ui's own test suite: `DismissiblePinnedBulletinBanner` (whole 38-line file — the base `PinnedBulletinBanner` IS used, at apps/web/app/(app)/camps/[slug]/page.tsx:29, but always without dismissal), `SkeletonTable` (skeleton.tsx:153-176), `SkeletonStats` (skeleton.tsx:179-199), and `markdownToHtml` (markdown.ts:27-29, which has no reference anywhere at all, not even a test). `SkeletonTable` is the sharpest one: apps/org/components/console-skeleton.tsx:59-73 hand-rolls exactly the row loop `SkeletonTable`/`SkeletonRow` already provide (same `flex items-center gap-4`, same `h-4 flex-1`, same alternating `w-24`/`w-16`), so the shared version sat unused while a caller reimplemented it 30 lines away. Unused shared components are pure carrying cost: they must be typed, tested and kept compiling forever, and they make the package's real surface harder to see.

**Evidence.** Per-symbol repo-wide grep across apps/, e2e/, scripts/, docs/, design/ and packages/ (--include=_.ts,_.tsx,_.md). `SkeletonTable`, `SkeletonStats`, `markdownToHtml` and `DismissiblePinnedBulletinBanner` return hits only inside packages/ui/src/components/skeleton.tsx, markdown-editor/markdown.ts, dismissible-pinned-bulletin-banner.tsx and their **tests** files; docs/ and e2e/ return nothing. Contrast with the same grep for `SkeletonRegion` (99 hits), `SkeletonCard` (50), `SkeletonForm` (10) — the kit is otherwise genuinely used. Confirmed packages/ui has no barrel index.ts; package.json exports `./components/_` directly, so there is no dynamic re-export path that could hide a consumer.

**Fix.** Delete dismissible-pinned-bulletin-banner.tsx (and its test file), `SkeletonTable` and `SkeletonStats` from skeleton.tsx, and `markdownToHtml` from markdown-editor/markdown.ts, along with the test blocks that are their only callers. Then rewrite apps/org/components/console-skeleton.tsx's `ConsoleTableSkeleton` body to compose `SkeletonRow` — or, if you keep `SkeletonTable`, make that function its single caller so it stops being dead.

> **Verifier.** Verified per symbol with repo-wide grep (apps/, e2e/, scripts/, docs/, design/, packages/). SkeletonTable: only skeleton.tsx:153 + skeleton.test.tsx. SkeletonStats: only skeleton.tsx:179 + test. markdownToHtml: markdown-editor/markdown.ts:27 and nowhere else, not even a test (roundTripMarkdown is the one the tests use). DismissiblePinnedBulletinBanner: only its own file (38 lines) + its test; base PinnedBulletinBanner is genuinely used at apps/web/app/(app)/camps/[slug]/page.tsx:29/270. Confirmed there is no packages/ui/src/index.ts barrel and package.json exports only ./components/_ (_.tsx) and four ./lib/\* paths — markdown.ts is not even reachable through the export map. The console-skeleton claim also holds: apps/org/components/console-skeleton.tsx:55-73 hand-rolls the same row loop (flex items-center gap-4, h-4 flex-1, alternating w-24/w-16) that SkeletonRow/SkeletonTable provide, differing only in the outer card class. Size 38+24+21+3 = 86, essentially the claimed 87.

### packages/ui's GateScreen is dead — both apps it was built for wrote their own instead

**Dead code** · ~51 lines · confidence: high

Sites:

- `packages/ui/src/components/gate-screen.tsx:27`
- `apps/org/components/gate-screen.tsx:20`
- `apps/suppliers/components/gate-screen.tsx:15`

The shared `GateScreen` layout shell in packages/ui has zero consumers outside its own unit test. Both surfaces it was specified for (docs/component-spec.md:30 "GateScreen = custom (blocking questionnaire gate + org wall)", docs/architecture.md:115-116) ship an app-local `GateScreen` of the same name instead. Worse, apps/org/components/gate-screen.tsx:15-18 documents WHY the shared one is unusable: it renders its own `QuiltBand`, which would double the band already rendered by the app root layout. So packages/ui carries a primitive that is structurally incompatible with its only two intended callers, and the repo has three different components called `GateScreen` — a name collision that will mislead the next person who greps for it.

**Evidence.** grep -rn "gate-screen" and "GateScreen" across apps/, e2e/, docs/, packages/, scripts/: the only importers of `@quagga/ui/components/gate-screen` are none; apps/org/app/(console)/layout.tsx:8, apps/org/lib/gate.tsx:14, apps/suppliers/app/(portal)/layout.tsx:8 and apps/suppliers/lib/gate.tsx:5 all import `@/components/gate-screen`. The only reference to the ui file is packages/ui/src/components/**tests**/account-chrome.test.tsx:8. Also grepped `QuiltBand` across apps to confirm no web-side blocking gate uses it either.

**Fix.** Delete packages/ui/src/components/gate-screen.tsx and its test block. If the shared shell is still wanted, re-cut it WITHOUT the internal QuiltBand (the caller's root layout owns the band) so org and suppliers can actually adopt it, and rename the app-local ones (ConsoleGate / PortalGate) so three files do not share one name.

> **Verifier.** Verified. Repo-wide grep for GateScreen/gate-screen: the only importer of packages/ui/src/components/gate-screen.tsx is packages/ui/src/components/**tests**/account-chrome.test.tsx:8. apps/org/app/(console)/layout.tsx:8, apps/org/lib/gate.tsx:14, apps/suppliers/app/(portal)/layout.tsx:8 and apps/suppliers/lib/gate.tsx:5 all import @/components/gate-screen (app-local). The shared file does render <QuiltBand /> internally (line 36), and apps/org/components/gate-screen.tsx lines 15-18 literally says adopting the @quagga/ui GateScreen 'would double that shared band'. docs/component-spec.md:30 and docs/architecture.md:115-116 name GateScreen as claimed. File is exactly 51 lines. Three same-named components confirmed (packages/ui, apps/org line 20, apps/suppliers line 15).

### Three apps each keep a one-line HeaderNotificationBell that only forwards to NotificationPanel

**Redundancy** · ~41 lines · confidence: high

Sites:

- `apps/web/components/header-notification-bell.tsx:13`
- `apps/org/components/header-notification-bell.tsx:11`
- `apps/suppliers/components/header-notification-bell.tsx:12`

All three files are the same component: a "use client" module whose entire body is `return <NotificationPanel count={count} />`. They add no state, no styling, no props of their own — only a rename and a docstring. Each has exactly one call site (app-shell.tsx:97, console-header.tsx:130, portal-header.tsx:68), all of which could import `NotificationPanel` directly. The indirection actively misleads: the name says "bell" but packages/ui already exports a real `NotificationBell` primitive, so a reader chasing the header bell lands on a shim, then a panel, then the actual ui component.

**Evidence.** Read all three files in full (14, 13 and 14 lines). Diffed them: identical apart from the comment and suppliers defaulting `count = 0`. grep -rn "HeaderNotificationBell" across apps/ returns exactly three definitions and three usages, one per app.

**Fix.** Delete the three header-notification-bell.tsx files and import `NotificationPanel` directly in app-shell.tsx, console-header.tsx and portal-header.tsx. Keep the useful sentence from each docstring on the call site if it earns it.

> **Verifier.** Verified by reading all three files. Each is 'use client' + one import + a docstring + `return <NotificationPanel count={count} />;` — no state, no styling, no extra props; suppliers differs only by `count = 0`. Grep for HeaderNotificationBell across apps/ returns exactly three definitions and three usages: apps/web/components/app-shell.tsx:13/97, apps/org/components/console-header.tsx:15/130, apps/suppliers/components/portal-header.tsx:9/68. The 'use client' directive adds nothing because each notification-panel.tsx already begins with 'use client', so the shim is not a client-boundary marker. packages/ui/src/components/notification-bell.tsx does export a real NotificationBell, which each panel renders (line ~51-55), confirming the three-hop naming confusion. 14+13+14 = 41 lines vs claimed 42.

### apps/org re-implements packages/ui's StatusBadge verbatim, and the copy has zero consumers

**Redundancy** · ~21 lines · confidence: high

Sites:

- `apps/org/components/status-badges.tsx:7`
- `apps/org/components/status-badges.tsx:20`
- `packages/ui/src/components/status-badge.tsx:17`
- `packages/ui/src/components/status-badge.tsx:56`

`REGISTRATION_STYLE` (apps/org/components/status-badges.tsx:7-18) restates all seven registration status → Badge variant pairs and all seven human labels already defined in packages/ui/src/components/status-badge.tsx:17-39. I compared them value by value: draft/outline, submitted/default, under_review/default, changes_requested/warning, approved/success, rejected/destructive, withdrawn/secondary — identical, and the labels are identical strings. `RegistrationStatusBadge` (line 20) is then just `<Badge variant={s.variant}>{s.label}</Badge>`, which is what the shared `StatusBadge` already does. And nothing imports it: the same org app imports the SHARED `StatusBadge` in registration-review.tsx:11 and registrations-table.tsx:8. So this is a dead second source of truth for a status vocabulary that must not drift.

**Evidence.** grep -rn "RegistrationStatusBadge|SupplierStandingBadge|CohortBadge" across the whole repo (--include=_.ts,_.tsx,\*.md): `RegistrationStatusBadge` appears ONLY at its own definition; `CohortBadge` is used at registrations-table.tsx:56 and `SupplierStandingBadge` at apps/org/app/(console)/registrations/[id]/page.tsx:323. Separately grepped "StatusBadge|REGISTRATION_STATUS_LABEL|REGISTRATION_STATUS_VARIANT" across apps/ and e2e/ — 8 call sites, all on the @quagga/ui component.

**Fix.** Delete `REGISTRATION_STYLE` and `RegistrationStatusBadge` from apps/org/components/status-badges.tsx (lines 7-27), keeping only `SupplierStandingBadge` and `CohortBadge`, which are genuinely org-specific and already delegate to @quagga/core.

> **Verifier.** Verified value-by-value. apps/org/components/status-badges.tsx:7-18 REGISTRATION_STYLE and packages/ui/src/components/status-badge.tsx:17-39 (REGISTRATION_STATUS_VARIANT + REGISTRATION_STATUS_LABEL) agree on all seven pairs and all seven label strings. RegistrationStatusBadge (line 20) is exactly <Badge variant={s.variant}>{s.label}</Badge>. Repo-wide grep for RegistrationStatusBadge returns exactly one hit — its own definition — while the same app imports the shared StatusBadge at registration-review.tsx:11 and registrations-table.tsx:8 (8 shared call sites across apps). SupplierStandingBadge/CohortBadge are genuinely org-specific and delegate to @quagga/core, so keeping them (as the fix proposes) is right. Size 21 lines (7-27) is accurate.

### Both config packages ship an entry point nobody extends

**Dead code** · ~21 lines · confidence: high

Sites:

- `packages/eslint-config/next.js:1`
- `packages/eslint-config/package.json:8`
- `packages/typescript-config/node.json:1`
- `packages/typescript-config/package.json:9`

`packages/eslint-config/next.js` exists to hold "Next.js / React-server-component-specific overrides" but its rules object is empty (line 6-8), so it is a spread of `./index.js` and nothing else — and no one imports it anyway: all three Next apps import the base config directly. `packages/typescript-config/node.json` has no extender at all. Both are listed in their package's `files` array, so they read as supported public entry points. A newcomer adding a Next-specific lint rule will reasonably put it in next.js and watch it have no effect on any app — that is the collaboration cost, not the twenty lines.

**Evidence.** grep -rn "quagga/eslint-config" across apps/, packages/, e2e/, config/, scripts/: nine eslint.config.js files, all `import base from "@quagga/eslint-config"` (apps/web, apps/org, apps/suppliers included) — zero `/next` imports. grep -rn "node.json|react-library|nextjs.json" across the same tree plus turbo.json and docs/: nextjs.json is extended by the three apps' tsconfig.json, react-library.json by packages/ui/tsconfig.json, base.json by types/auth/db/core/e2e — node.json appears only in its own package.json `files` list. Also grepped docs/, CONTRIBUTING.md, AGENTS.md and README.md for either name: nothing, so neither is a documented convention.

**Fix.** Either delete packages/eslint-config/next.js + packages/typescript-config/node.json (and their `files` entries), or make them real: point apps/{web,org,suppliers}/eslint.config.js at `@quagga/eslint-config/next` so the Next-specific slot has somewhere to land.

> **Verifier.** Verified. packages/eslint-config/next.js is 10 lines: spread of ./index.js plus an empty rules object with only a placeholder comment. Grep across apps/, packages/, e2e/, config/, scripts/ finds nine eslint.config.js files, every one `import base from "@quagga/eslint-config"` — zero `/next` imports, including the three Next apps. packages/typescript-config/node.json exists (11 lines) and is extended by nothing: apps/{web,org,suppliers}/tsconfig.json extend nextjs.json, packages/ui extends react-library.json, everything else base.json; node.json appears only in its own package.json files array (line 9). Both are listed in `files` (eslint-config package.json line 8, typescript-config line 9), so they read as supported entry points. Nothing in AGENTS.md/CONTRIBUTING.md/README/docs documents either as a deliberate convention. ~21 lines total.

### `slugify` is duplicated character-for-character between packages/db and apps/web

**Redundancy** · ~12 lines · confidence: high

Sites:

- `packages/db/src/seed.ts:96`
- `apps/web/lib/groups-store.ts:74`

packages/db/src/seed.ts:96-105 and apps/web/lib/groups-store.ts:74-83 are the same nine-line function body — same NFKD normalize, same combining-mark strip, same `[^a-z0-9]+` → `-`, same trim, same `|| "camp"` fallback. The comment above the db copy (seed.ts:93-94) states the reason: "apps/web's slugify is a 'server-only' module and not importable from a standalone db script". That is a true statement about the CURRENT placement, not a reason the logic must exist twice — both packages already depend on @quagga/core (packages/db/package.json dependencies, and seed.ts:60-68 already imports seven symbols from it). A camp slug is a shared identity rule; two copies means a slug produced by the seed and a slug produced by the app can silently diverge.

**Evidence.** Read both bodies side by side (sed -n '73,83p' apps/web/lib/groups-store.ts and sed -n '93,106p' packages/db/src/seed.ts) — identical apart from the doc comment. grep -rn "function slugify|slugify(" across apps/ and packages/ also turned up two further, differently-shaped slug helpers (apps/org/components/questionnaire/builder.tsx:114, apps/org/lib/questionnaires/actions.ts:63) and packages/core/src/org-roles.ts:124 `departmentKeyFrom`, so this is the second-worst of five near-relatives and the only exact clone. Confirmed packages/core/src/index.ts re-exports ./org-roles (line 163), i.e. core is already the home for this kind of normalizer.

**Fix.** Move the function to packages/core (e.g. `campSlug` in a slug module, exported from core's index barrel) and import it from both packages/db/src/seed.ts and apps/web/lib/groups-store.ts. Delete the two local copies and the stale "kept in-script" comment.

> **Verifier.** Verified byte-for-byte: packages/db/src/seed.ts:96-105 and apps/web/lib/groups-store.ts:74-83 have identical bodies (NFKD normalize, combining-mark strip, toLowerCase, [^a-z0-9]+ → '-', ^-+|-+$ trim, || "camp"). The stale justification comment is at seed.ts:93-94 as claimed. packages/db/package.json does depend on @quagga/core (workspace:\*), as does apps/web, and packages/core/src/index.ts:163 re-exports ./org-roles (home of departmentKeyFrom, the same kind of normalizer) — so the proposed move to core is feasible. The other slug helpers cited (apps/org/components/questionnaire/builder.tsx:114, apps/org/lib/questionnaires/actions.ts:63) exist and are differently shaped, so the 'only exact clone' framing is accurate. Both call sites are live (seed.ts:532, groups-store.ts:849) and groups-store's copy is unit-tested.

### @quagga/auth's barrel publishes ten symbols that are internal-only

**Collaboration hazard** · ~10 lines · confidence: high

Sites:

- `packages/auth/src/index.ts:28`
- `packages/auth/src/index.ts:30`
- `packages/auth/src/index.ts:37`
- `packages/auth/src/index.ts:43`

The index barrel re-exports `createAuth`, `buildAuthOptions`, `sendAuthEmail`, `isReauth`, `AUTH_COOKIE_DOMAIN`, `AUTH_RP_NAME`, `PRODUCTION_ORIGINS`, `authConfigWarnings`, `resolvePasskeyOrigins` and `resolveTrustedOrigins`, none of which is imported by any app, e2e spec, script or sibling package. Every one is either consumed inside packages/auth (config.ts wires them) or imported straight from `../config` / `../env` by the unit tests, which never go through the barrel. The result is a public API roughly twice as wide as the real one, so a reader cannot tell from index.ts what other code is actually allowed to depend on — and a future refactor of, say, `buildAuthOptions` looks like a breaking change when it is not.

**Evidence.** For each of the 26 symbols in packages/auth/src/index.ts I ran a word-boundary grep across apps/, e2e/, scripts/, config/ and packages/{core,db,ui,types}. The ten above returned zero hits; `auth` (717), `isAuthConfigured` (48), `sendSingleEmail` (10), `AUTH_SESSION` (5), `withReauth` (4), `resolveRequireEmailVerification` (4) and the rest are genuinely consumed. A second grep restricted to packages/auth/src confirmed each of the ten is used by config.ts, env.ts or a **tests** file importing the module path directly (e.g. deletion-hook.test.ts:3-4 imports `../config` and `../reauth`, not the barrel).

**Fix.** Trim the barrel to the symbols with external consumers (`auth`, `Auth`, `sendSingleEmail`, `AuthEmailInput`/`AuthEmailKind`, `withReauth`, `isAuthConfigured`, `isEmailProviderConfigured`, `isGoogleConfigured`, `AUTH_SESSION`, `AUTH_APEX_DOMAIN`, `isUnderApex`, `parseBoolEnv`, the resolve\* functions system-status.ts reads, `AuthEnv`). Tests already import module paths directly, so nothing breaks.

> **Verifier.** Verified with a word-boundary grep for each of the ten across apps/, e2e/, scripts/, config/ and packages/{core,db,ui,types}: createAuth, buildAuthOptions, sendAuthEmail, isReauth, AUTH_COOKIE_DOMAIN, AUTH_RP_NAME, PRODUCTION_ORIGINS, authConfigWarnings, resolvePasskeyOrigins, resolveTrustedOrigins all return ZERO hits outside packages/auth. Inside packages/auth each is consumed by config.ts/env.ts or by a **tests** file that imports ../config, ../env or ../reauth directly, never the barrel (e.g. deletion-hook.test.ts:3-4), so trimming the barrel breaks nothing. Barrel line numbers check out: 28 (createAuth/buildAuthOptions), 30 (sendAuthEmail), 37 (isReauth), 43 opens the ./env export block containing the other six. One nit in the proposed fix, not enough to refute it: apps/org/lib/system-status.ts imports the resolve\* functions from the '@quagga/auth/env' SUBPATH, not the barrel, so those barrel re-exports are unused too by the finding's own standard.

### packages/db/src/migrate.ts keeps a compatibility re-export whose comment contradicts the code

**Redundancy** · ~6 lines · confidence: high

Sites:

- `packages/db/src/migrate.ts:100`
- `packages/db/src/migrate.ts:106`
- `packages/db/src/__tests__/migrate.test.ts:2`
- `packages/db/src/index.ts:27`

migrate.ts:106-111 re-exports `connectionHost`, `isPoolerConnection`, `planMigration` and `MigrationPlan` from ./migration-plan, justified at line 103-104 as "Re-exported here because this is where every existing caller and test looks for them." That is no longer true of anything but one test file. The real consumer, apps/org/lib/system-status.ts:53, imports them from `@quagga/db`, which gets them from ./migration-plan directly (index.ts:27-32); migrate.ts itself imports them from ./migration-plan at line 75. The net effect is three import paths for the same four pure functions and a comment that actively misinforms a reader about which one is canonical — in the one module the project's own AGENTS.md flags as the most dangerous thing in the repo.

**Evidence.** grep -rn for imports of `../migrate`/`./migrate` inside packages/db/src: only **tests**/migrate.test.ts:2 (`import { connectionHost, isPoolerConnection, planMigration } from "../migrate"`) and **tests**/migrate-runner.test.ts:72 (`runDeployMigrations`, which genuinely lives in migrate.ts). grep -rn "migration-plan" across apps/, e2e/, scripts/, packages/: packages/db/src/index.ts:32 and migrate.ts:75/111 only; apps/org/lib/system-status.ts:53 imports from "@quagga/db".

**Fix.** Change packages/db/src/**tests**/migrate.test.ts:2 to import from `../migration-plan`, then delete the re-export block at migrate.ts:106-111 and the paragraph at 100-105 that describes it.

> **Verifier.** Verified. migrate.ts:100-105 carries the 'this is where every existing caller and test looks for them' comment and 106-111 re-exports connectionHost, isPoolerConnection, planMigration and type MigrationPlan from ./migration-plan. migrate.ts itself imports connectionHost/planMigration from ./migration-plan at line 75, and packages/db/src/index.ts:27-32 re-exports the same four from ./migration-plan directly. The real external consumer apps/org/lib/system-status.ts:53 imports { connectionHost, planMigration } from "@quagga/db" (the index path). The only importer of ../migrate for these symbols is packages/db/src/**tests**/migrate.test.ts:2; **tests**/migrate-runner.test.ts:72 imports runDeployMigrations, which genuinely lives in migrate.ts, so the proposed fix does not break it. Claim is accurate as written.

### rate-limit.ts's "if you change one, change both" comment points at a rule that does not exist

**Collaboration hazard** · ~5 lines · confidence: high

Sites:

- `packages/db/src/rate-limit.ts:40`
- `packages/auth/src/env.ts:141`
- `packages/auth/src/env.ts:166`

packages/db/src/rate-limit.ts:41-45 says the forgot-password budget "Mirrors the `customRules` entry for /forget-password in @quagga/auth's env.ts — if you change one, change both." Read packages/auth/src/env.ts:141-172: `resolveRateLimit` returns `{}` unless `AUTH_RATE_LIMIT_WINDOW_SECONDS` or `AUTH_RATE_LIMIT_MAX` is set, and the `/forget-password` rule is only constructed when `AUTH_RATE_LIMIT_MAX` is a positive number — its window and max then come from those env vars, never from 3 / 15 minutes. The docstring at env.ts:139 even says "Production must leave these unset." So in production there is no customRules entry to mirror, and in test environments the numbers are deliberately different. The instruction is impossible to follow, which is the worst kind of comment: it will send someone editing a security-relevant limit hunting for a second site that isn't there, or hand-editing env.ts to "keep them in sync" and loosening the test-only escape hatch.

**Evidence.** Read packages/db/src/rate-limit.ts:37-47 and packages/auth/src/env.ts:138-173 in full. grep -rn "FORGOT_PASSWORD_MAX_PER_WINDOW|FORGOT_PASSWORD_WINDOW_SECONDS" across apps/ and packages/ shows the constants are properly shared from one place (packages/db/src/rate-limit.ts:46-47 → index.ts:20-21 → apps/web/lib/account-actions.ts:266, apps/org/lib/actions/password.ts:51, apps/suppliers/lib/actions/password.ts:45) — there is no second definition anywhere.

**Fix.** Rewrite the comment to state the actual relationship: this is the ONLY forgot-password budget for the in-process server-action path; @quagga/auth's `resolveRateLimit` customRules are an env-gated override for test environments and are unset in production. Drop the "change both" instruction.

> **Verifier.** Substantively verified, though the title overstates. packages/db/src/rate-limit.ts:40-47 does say 'Mirrors the customRules entry for /forget-password in @quagga/auth's env.ts — if you change one, change both', with FORGOT_PASSWORD_MAX_PER_WINDOW = 3 and WINDOW = 15\*60. packages/auth/src/env.ts resolveRateLimit returns {} unless AUTH_RATE_LIMIT_WINDOW_SECONDS or AUTH_RATE_LIMIT_MAX is set, and builds customRules (including '/forget-password') only when hasMax, with window/max taken from those env vars; the docstring says 'Production must leave these unset.' So the instruction is genuinely unfollowable — there is no literal to keep in sync, and in production no rule is constructed at all. Correction to the finding: a '/forget-password' entry does exist in source (env.ts ~line 169), so the title's 'a rule that does not exist' is wrong; the accurate statement is that the rule is env-gated and never carries 3 / 15 min. The constants are otherwise single-sourced (index.ts → apps/web/lib/account-actions.ts, apps/org/lib/actions/password.ts, apps/suppliers/lib/actions/password.ts), confirming there is no second definition. Not taste, not a documented decision — the proposed comment rewrite is the right fix.

### packages/ui declares three export subpaths nobody imports

**Dead code** · ~3 lines · confidence: high

Sites:

- `packages/ui/package.json:13`
- `packages/ui/package.json:14`
- `packages/ui/package.json:15`

`./lib/client-errors`, `./lib/report-client` and `./lib/use-dictation` are declared as public entry points, but every consumer of those modules is inside packages/ui and reaches them by relative path (client-error-capture.tsx:5, report-dialog.tsx:39-40, report-diagnostics.tsx:22). Meanwhile three lib modules that are also only used internally — lib/wizard.ts, lib/bulletin.ts, lib/form-logic.ts — are NOT declared. So the export map does not describe either the real public surface or the real internal one; it is three lines of noise that imply an integration contract that does not exist.

**Evidence.** grep -rn "@quagga/ui/lib/" across apps/, e2e/, scripts/ and packages/ returns 27 hits, all `@quagga/ui/lib/utils`. Per-module grep for lib/client-errors, lib/report-client and lib/use-dictation returns only relative-path imports from within packages/ui/src plus its **tests** files.

**Fix.** Delete lines 13-15 of packages/ui/package.json. If any of those modules is later needed by an app, add the subpath back at that moment.

> **Verifier.** Verified. packages/ui/package.json lines 13-15 declare ./lib/client-errors, ./lib/report-client, ./lib/use-dictation. Grep for '@quagga/ui/lib/' across apps/, e2e/, scripts/ and packages/ returns 26 hits, every one '@quagga/ui/lib/utils'. Every consumer of the three modules is inside packages/ui via relative path: client-error-capture.tsx:5, report-dialog.tsx:39-40, report-diagnostics.tsx:22, plus **tests** files. And ls packages/ui/src/lib confirms wizard.ts, bulletin.ts and form-logic.ts exist and are NOT declared, so the export map describes neither surface. 3 lines is exact.

---

## Build, test and CI plumbing

_The build/test/CI plumbing is unusually well-reasoned for a repo this size — the shared `@quagga/eslint-config` and `@quagga/typescript-config` packages are real (nine workspaces extend them with 1-8 line files, not copy-paste), the tsconfig hierarchy (base → nextjs/react-library) is clean and each workspace's override is 3-7 lines of genuinely local config, and the coverage floors live in one place per workspace rather than being duplicated into CI (ci.yml runs `pnpm --filter X test:coverage` and lets vitest.config.ts decide, exactly as its own comment at line 334 claims). `scripts/e2e-local.sh` being the single implementation shared by developers and both e2e workflows is the right call and is honoured. commitlint.config.mjs, .gitattributes, .prettierignore and docker-compose.local.yml are all clean, well-commented and consistent with the code they describe — I checked each against reality (e.g. .prettierignore's `docs/sources/` exclusion, .gitattributes' `*.pen -merge`, the two-proxy compose setup vs packages/db's driver split) and found no drift. Where the area is weak is in the seams: the same env var must be declared in up to three uncoordinated places (.env.example, turbo.json globalEnv, e2e-local.sh) and .env.example has fallen behind all of them; adding a workspace touches ~7 files and adding an e2e persona touches 4, with no checklist anywhere; the GitHub Actions setup block and the persona matrix are the two largest genuine copy-paste sites and both would collapse to a single definition with a composite action and a reusable workflow. I verified every "dead" claim with a repo-wide grep including e2e/, scripts/, docs/ and tests, and checked subpath/barrel reachability for the two dead preset files before reporting them. I deliberately did not report the per-workspace coverage thresholds or the long explanatory comments in the vitest configs as duplication — they differ per workspace, each records a measured number, and AGENTS.md's stance on coverage makes them clearly deliberate._

### The three apps' vitest configs duplicate an identical `resolve.alias` block and an identical `server-only` stub file, and all eight configs repeat the same ~8 lines of vitest boilerplate

**Redundancy** · ~70 lines · confidence: medium

Sites:

- `/home/user/afrikaburn-contributors-app/apps/web/vitest.config.ts:92`
- `/home/user/afrikaburn-contributors-app/apps/org/vitest.config.ts:93`
- `/home/user/afrikaburn-contributors-app/apps/suppliers/vitest.config.ts:71`
- `/home/user/afrikaburn-contributors-app/apps/web/test/stubs/server-only.ts:1`
- `/home/user/afrikaburn-contributors-app/apps/org/test/stubs/server-only.ts:1`
- `/home/user/afrikaburn-contributors-app/apps/suppliers/test/stubs/server-only.ts:1`

The three apps each carry the same 9-line `resolve: { alias: { "server-only": …, "@": dir } }` block including a verbatim-identical 3-line comment, the same 5-line `path.dirname(fileURLToPath(...))` preamble, and a 5-line `test/stubs/server-only.ts` file whose contents (comment included) are identical across all three. Across all eight vitest.config.ts files, the same option lines recur verbatim: `environment: "node"` (7x), `include: ["**/__tests__/**/*.test.ts"]` (8x), `provider: "v8"` (8x), `reporter: ["text", "json-summary", "json"]` (8x), `reportOnFailure: true` (8x). The per-workspace comments and thresholds are genuinely bespoke and load-bearing — this is not a proposal to flatten those — but the mechanical scaffolding around them is not. Adding a ninth workspace today means hand-copying ~40 lines of boilerplate, and there is no documented checklist for it.

**Evidence.** Dumped all eight vitest.config.ts files with line numbers. apps/web:92-100, apps/org:93-101 and apps/suppliers:71-79 are the same nine lines including the comment text "Modules under test are marked `server-only`…". `cat` of the three `test/stubs/server-only.ts` files returned identical 5-line contents. Counted the recurring option lines across the eight configs. Confirmed no AGENTS.md or CONTRIBUTING.md convention endorses per-workspace duplication (`grep -n 'vitest.config|eslint.config|tsconfig'` over both → only AGENTS.md:41 and :243, neither about config layout).

**Fix.** Add `config/vitest.base.ts` exporting `nodeWorkspaceConfig({ include, coverage })` and `nextAppConfig({ dir, ... })` — the latter supplying the shared alias block and pointing all three apps at a single `config/stubs/server-only.ts`. Each workspace's file then keeps only its own thresholds and its own comments, which is the part worth reading.

> **Verifier.** Main claims confirmed. The 9-line `resolve: { alias: { "server-only": path.join(dir, "test/stubs/server-only.ts"), "@": dir } }` block — including the verbatim 3-line comment beginning "Modules under test are marked `server-only`" — appears at apps/web:92-100, apps/org:93-101 and apps/suppliers:71-79, identical in all three. Lines 1-5 (the path/fileURLToPath/defineConfig preamble and `const dir = ...`) are identical in all three. `diff` of the three test/stubs/server-only.ts files shows all three are the same 5 lines, comment included. Across the eight configs: `provider: "v8"` 8x, `reportOnFailure: true` 8x, `reporter: ["text", "json-summary", "json"]` 8x — all confirmed by grep -c. One sub-detail is wrong and should be corrected rather than treated as fatal: `environment: "node"` is 7x (packages/ui:7 is `"jsdom"`) as the finding itself states, but `include` is NOT one verbatim string 8x — it is `["lib/**/__tests__/**/*.test.ts"]` in the three apps and `["src/**/__tests__/**/*.test.ts"]` in four packages, with packages/ui differing again. The finding correctly scopes itself to the mechanical scaffolding and explicitly leaves the bespoke thresholds and comments alone, which I confirmed are genuinely per-workspace (web carries per-file floors for medical-access.ts / account-sanitize.ts; org and suppliers carry different JSX-transform rationales). Size ~70 against ~57 lines of strictly verbatim duplication plus the recurring option lines — within range.

### The checkout/pnpm/Node/install block is copy-pasted across 5 CI jobs, pinning pnpm 10.30.0 and Node 22 in 5 places each

**Redundancy** · ~60 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:43`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:82`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:96`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:165`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:415`
- `/home/user/afrikaburn-contributors-app/.github/workflows/mobile.yml:67`
- `/home/user/afrikaburn-contributors-app/package.json:29`

Every job repeats the identical four steps: `actions/checkout@v4`, `pnpm/action-setup@v4` with `version: 10.30.0`, `actions/setup-node@v4` with `node-version: 22, cache: pnpm`, and `pnpm install --no-frozen-lockfile`. That is ~14 lines x 5 = ~70 lines of pure repetition. Bumping pnpm means editing ci.yml lines 50, 87, 170, 422, mobile.yml line 72 AND root package.json:29 `packageManager` — six places, and a mismatch between the workflow pin and `packageManager` is not caught by anything. Node 22 is likewise in five workflow spots plus `engines.node` (package.json:31). ci.yml:96-97 also carries a stale TODO ("Switch this to `--frozen-lockfile` once pnpm-lock.yaml is committed") — pnpm-lock.yaml is committed at the repo root, 270KB, so the stated precondition has been met and the comment now misleads.

**Evidence.** `grep -n '10.30.0|node-version' .github/workflows/*.yml` → ci.yml:50,55,87,92,170,175,422,427 and mobile.yml:72,77. `grep -c 'Install pnpm'` → ci.yml 4, mobile.yml 1. Read root package.json:29 (`"packageManager": "pnpm@10.30.0"`) and :31 (`"node": ">=22"`). `ls -la` confirms pnpm-lock.yaml exists at the root (270399 bytes), contradicting ci.yml:96-97.

**Fix.** Add `.github/actions/setup/action.yml` (composite: checkout + pnpm + node + install, with `fetch-depth` as an input for the two jobs that need 0), replacing five blocks with five one-line `uses:`. Read the pnpm version from `packageManager` via `pnpm/action-setup`'s no-version mode so root package.json is the single source. Resolve the stale `--frozen-lockfile` comment either way.

> **Verifier.** Confirmed by grep across .github/workflows/\*.yml. `version: 10.30.0` at ci.yml:50, 87, 170, 422 and mobile.yml:72 — five pins. `node-version: 22` at ci.yml:55, 92, 175, 427 and mobile.yml:77 — five pins. `pnpm install --no-frozen-lockfile` at ci.yml:59, 99, 179, 457 and mobile.yml:81. Root package.json:29 is `"packageManager": "pnpm@10.30.0"` and :31 is `"node": ">=22"`, so a bump is six edits with nothing cross-checking the workflow pin against packageManager. The stale TODO is real: ci.yml:96-98 reads "No committed lockfile on the first CI run ... Switch this to `--frozen-lockfile` once pnpm-lock.yaml is committed", and `git ls-files pnpm-lock.yaml` confirms it is tracked (270399 bytes) — the stated precondition has been met. Minor note: the coverage job's install step is at line 457 rather than immediately after node setup (a scope-check step sits between), so its block is not a byte-identical copy, but the four pinned lines are. Size ~60 lines against ~70 lines of actual repetition — not inflated.

### The 8-persona e2e matrix and its two artefact steps are maintained twice, in ci.yml and mobile.yml, with no mechanism keeping them in sync

**Redundancy** · ~40 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:140`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:293`
- `/home/user/afrikaburn-contributors-app/.github/workflows/mobile.yml:50`
- `/home/user/afrikaburn-contributors-app/.github/workflows/mobile.yml:100`

ci.yml lines 139-163 and mobile.yml lines 50-65 declare the same eight personas with the same eight label strings ("anon · signed-out surfaces + privacy" etc.), differing only in ci.yml carrying an extra `side:` key that nothing in the file ever reads. The "Collect the app server log" and "Upload the report" steps (ci.yml 293-308 vs mobile.yml 100-113) are also near-identical, differing only in the artefact name prefix. Adding or renaming a persona today means editing four places: the matrix in ci.yml, the `E2E_WORKERS` conditional expression at ci.yml:219-224 which hardcodes five persona names, the matrix in mobile.yml, and the specs directory. Miss the mobile.yml edit and the nightly triage list silently stops covering the new persona — the exact silent-omission failure mode ci.yml:310-316 argues against for required checks. There is no "adding a persona" checklist in any doc (grepped).

**Evidence.** Read .github/workflows/ci.yml lines 138-163 and 293-308, and mobile.yml lines 48-65 and 100-113 — the eight persona/label pairs match string-for-string. `grep -rn -i 'new persona|add a workspace'` across \*.md → zero hits. The `side:` key in ci.yml's matrix appears nowhere else in the file.

**Fix.** Extract the e2e run into a reusable workflow (`workflow_call`) parameterised by project/retries/artifact-prefix, with the persona matrix declared once; have both ci.yml and mobile.yml call it. Drop the unused `side:` key, or reference it in the job name if it was meant to be visible.

> **Verifier.** Core claim confirmed string-for-string. ci.yml:140-163 and mobile.yml:50-65 declare the same eight persona/label pairs with identical label text ("anon · signed-out surfaces + privacy", "ORG system manager · anti-lockout, escalation refusals", etc.); ci.yml adds a `side:` key on each. ci.yml:293-308 (Collect the app server log + Upload the report, `playwright-report-${{ matrix.persona }}`) and mobile.yml:100-113 (`mobile-report-${{ matrix.persona }}`) differ only in the artefact-name prefix. ci.yml:219-224 does hardcode five persona names in the E2E_WORKERS expression. `grep -rni 'adding a persona|new persona|add a persona'` over \*.md returns zero — no checklist exists. `grep -n 'matrix.side'` returns zero: the key is written eight times and read nowhere. One partial correction: the proposal to drop `side:` is weaker than stated, because ci.yml:134-137 explicitly documents it as a reading aid ("`side` marks which app each persona exercises... the two worth reading first when the board goes red") — that sub-point is deliberate, but it is incidental to the finding, which stands on the duplicated matrix and artefact steps. Size ~40 lines is fair (16 matrix + 14 steps duplicated, larger restructure to fix).

### Four dead build-plumbing artefacts: an unused eslint preset, an unused tsconfig preset, a turbo task nothing invokes, and a root script nothing calls

**Dead code** · ~30 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/packages/eslint-config/next.js:1`
- `/home/user/afrikaburn-contributors-app/packages/eslint-config/package.json:9`
- `/home/user/afrikaburn-contributors-app/packages/typescript-config/node.json:1`
- `/home/user/afrikaburn-contributors-app/packages/typescript-config/package.json:9`
- `/home/user/afrikaburn-contributors-app/turbo.json:78`
- `/home/user/afrikaburn-contributors-app/package.json:18`

(a) `packages/eslint-config/next.js` is a 10-line wrapper whose entire body is an empty `rules: {}` placeholder; no eslint.config.js in the repo imports `@quagga/eslint-config/next` — all nine import the bare package. (b) `packages/typescript-config/node.json` (12 lines) is extended by nothing; only `base.json`, `nextjs.json` and `react-library.json` are used. (c) turbo.json's `e2e` task (lines 78-82) is never reached — nothing anywhere runs `turbo run e2e`; both `scripts/e2e-local.sh:244` and the CI e2e job invoke playwright directly. Its two non-default options (`persistent: false`, `dependsOn: []`) are turbo defaults anyway. (d) The root `"commitlint": "commitlint"` script is never invoked: CI uses `pnpm exec commitlint` (ci.yml:66,73) and the hook uses `npx --no -- commitlint` (.husky/commit-msg:8). Each of these is a thing a contributor has to read, evaluate and rule out.

**Evidence.** `grep -rn 'eslint-config'` across all source/config/docs → nine `import base from "@quagga/eslint-config"` and zero `/next` subpath imports. `grep -rn 'typescript-config/node|node.json|react-library'` → only packages/ui/tsconfig.json:2 uses react-library; node.json appears only in its own package.json `files` array. `grep -rn 'turbo run e2e|turbo e2e'` across the repo → zero hits. `grep -rn commitlint` across \*.md and workflows → CONTRIBUTING.md:208 (mentions the config file only), ci.yml:66,73 (`pnpm exec`), .husky/commit-msg:8 (`npx`); no `pnpm commitlint` anywhere.

**Fix.** Delete `packages/eslint-config/next.js` and its `files` entry; delete `packages/typescript-config/node.json` and its `files` entry; delete the `e2e` task block from turbo.json (or wire `pnpm e2e:local` through it if the task was intended); delete the root `commitlint` script.

> **Verifier.** All four confirmed by repo-wide grep (excluding node_modules and pnpm-lock.yaml). (a) packages/eslint-config/next.js is 10 lines ending in an empty `rules: {}` placeholder; every one of the nine eslint.config.js files in the repo does `import base from "@quagga/eslint-config"` — zero `/next` subpath imports, and there is no `exports` map that would make it reachable another way. (b) packages/typescript-config/node.json (12 lines) appears in exactly one place repo-wide: its own package.json:9 `files` array. Only base.json, nextjs.json and react-library.json are extended by real tsconfigs. (c) `grep -rn 'turbo run e2e|turbo e2e'` returns zero hits; root package.json:15 wires `e2e:local` to ./scripts/e2e-local.sh, and e2e/package.json:10 has an `e2e` script that only playwright/CI invoke directly. turbo.json:78-82 is unreachable, and `persistent: false` / `dependsOn: []` are indeed turbo defaults. (d) root package.json:18 `"commitlint": "commitlint"` — every consumer bypasses it: ci.yml:66 and :73 use `pnpm exec commitlint`, .husky/commit-msg:8 uses `npx --no -- commitlint`, CONTRIBUTING.md:208 only names the config file. None of these is a framework entrypoint or string-referenced. Size ~30 lines matches (10 + 12 + 5 + 1 + 2 files entries).

### apps/org and apps/suppliers next.config.ts are byte-identical; apps/web differs by one array element

**Redundancy** · ~30 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/apps/org/next.config.ts:1`
- `/home/user/afrikaburn-contributors-app/apps/suppliers/next.config.ts:1`
- `/home/user/afrikaburn-contributors-app/apps/web/next.config.ts:1`

All three files carry the same imports, the same 3-line workspace-root-pinning comment and computation, and the same config object; `apps/org` and `apps/suppliers` are literally identical files. The only real difference is that web's `transpilePackages` adds `@quagga/db`. The repo already has the right home for this — `config/security-headers.mjs` is imported by all three for exactly this reason — so the pattern is established and just wasn't applied to the rest of the config. Today a change to the turbopack root or a new transpiled package means editing three files and hoping all three stay in step.

**Evidence.** `diff apps/org/next.config.ts apps/suppliers/next.config.ts` → no output (identical). Read all three files with line numbers: lines 1-13 and 15-19 match across all three; only web's lines 14-19 differ by including `"@quagga/db"`.

**Fix.** Add `config/next-base.mjs` exporting a `baseNextConfig({ transpilePackages })` factory alongside `security-headers.mjs`; reduce each app's next.config.ts to ~5 lines.

> **Verifier.** `diff apps/org/next.config.ts apps/suppliers/next.config.ts` produces no output — identical files, 19 lines each. apps/web/next.config.ts (24 lines) shares lines 1-13 verbatim (same imports, the same `// Shared across all three apps — see config/security-headers.mjs.` comment, the same 2-line workspace-root-pinning comment and the same `appDir`/`repoRoot` computation) and differs only by adding `"@quagga/db"` to transpilePackages, which prettier splits across lines 14-19. The precedent the finding cites is real: config/security-headers.mjs is imported by all three for exactly this purpose, so the extraction pattern is established rather than invented. Size ~30 lines is reasonable against ~26 lines of verbatim duplication across the two non-canonical copies.

### `.env.example` is stale in three ways at once: it ships two dead vars, contradicts the repo's own hard rule about migrations, and omits 10 of the 15 vars in turbo.json's globalEnv

**Collaboration hazard** · ~25 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/.env.example:7`
- `/home/user/afrikaburn-contributors-app/.env.example:12`
- `/home/user/afrikaburn-contributors-app/.env.example:19`
- `/home/user/afrikaburn-contributors-app/.env.example:20`
- `/home/user/afrikaburn-contributors-app/turbo.json:5`
- `/home/user/afrikaburn-contributors-app/apps/web/package.json:8`
- `/home/user/afrikaburn-contributors-app/apps/org/package.json:8`
- `/home/user/afrikaburn-contributors-app/apps/suppliers/package.json:8`

This file is the first thing a new contributor copies (README.md:89 says `# .env — copy from .env.example`), and every claim in it is now wrong. (a) Lines 19-20 declare `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET`; docs/accounts-security-spec.md:18 states outright that "no `NEON_AUTH_*` variable is read anywhere" and a repo-wide grep confirms zero code references. (b) Lines 12-13 say migrations are "only ever applied MANUALLY … the build never migrates", while all three apps' build scripts are `pnpm --filter @quagga/db db:migrate:deploy && next build` (apps/web/package.json:8, apps/org:8, apps/suppliers:8) and AGENTS.md hard rule #1 spells out that the build IS the only thing that applies them. (c) Lines 7-9 instruct contributors to mirror every new var into turbo.json `globalEnv` — yet the file itself lists only 5 of turbo.json's 15 entries, omitting `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL_UNPOOLED`, `GOOGLE_CLIENT_ID/SECRET`, `AUTH_RATE_LIMIT_WINDOW_SECONDS/MAX`, `BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION`, `NODE_ENV`. Conversely `ACCOUNT_SWEEP_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_PARTICIPANT_APP_URL` are read by real code but appear in neither file.

**Evidence.** Read .env.example in full (46 lines). `grep -rn NEON_AUTH` over the whole repo → only .env.example:19,20 and docs/accounts-security-spec.md:18 (which says it is unused). `grep -rn 'process.env.ACCOUNT_SWEEP_SECRET'` → apps/web/app/api/account/deletion-sweep/route.ts:56,111,130; `CRON_SECRET` → same file:57; `NEXT_PUBLIC_PARTICIPANT_APP_URL` → apps/org/lib/config.ts:23, apps/suppliers/lib/config.ts:27 — none of the four are in turbo.json globalEnv (read lines 5-21). Read apps/{web,org,suppliers}/package.json line 8 and AGENTS.md lines 90-96.

**Fix.** Regenerate `.env.example` from the union of `turbo.json` globalEnv plus the vars `scripts/e2e-local.sh` exports (lines 23-56); delete the two `NEON_AUTH_*` lines; correct the migration comment on lines 12-13 to match AGENTS.md rule #1; and add `ACCOUNT_SWEEP_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PARTICIPANT_APP_URL` to turbo.json globalEnv so the stated convention actually holds.

> **Verifier.** All three sub-claims independently confirmed. (a) `grep -rn NEON_AUTH` over the whole repo (excluding node*modules/lockfile) returns exactly three hits: .env.example:19, :20 and docs/accounts-security-spec.md:18, which itself says no NEON_AUTH*\* var is read anywhere. Zero code references. (b) .env.example:12-13 reads "Migrations are only ever applied MANUALLY ... the build never migrates"; all three apps' package.json line 8 is `pnpm --filter @quagga/db db:migrate:deploy && next build` and AGENTS.md hard rule #1 (line ~91-99) states "the build is the only thing that applies them". Direct contradiction, confirmed. (c) turbo.json:5-21 has exactly 15 globalEnv entries; .env.example declares 8 vars of which 6 are in globalEnv, and ACCOUNT_SWEEP_SECRET / CRON_SECRET / NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_PARTICIPANT_APP_URL are read by real code (apps/web/app/api/account/deletion-sweep/route.ts:56-57,111,130; apps/web/lib/account-actions.ts:536; apps/org/lib/config.ts:23; apps/suppliers/lib/config.ts:27) yet appear in neither file. README.md:89 does say `# .env — copy from .env.example`. Two arithmetic slips, neither material: .env.example covers 6 (not 5) of the 15, and omits 9 (not 10) — NODE_ENV, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET, BETTER_AUTH_URL, BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION, AUTH_RATE_LIMIT_WINDOW_SECONDS, AUTH_RATE_LIMIT_MAX, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Size ~25 lines is right for the described edit.

### The 22-line "THE ONE REQUIRED CHECK" comment describing `ci-pass` is attached to the `coverage` job, ~200 lines from the job it documents

**Collaboration hazard** · ~22 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:310`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:332`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:373`
- `/home/user/afrikaburn-contributors-app/.github/workflows/ci.yml:518`

Lines 310-331 explain branch protection, why `CI pass` is the single required check, and why `if: always()` is load-bearing. Line 332 then starts a second, unrelated comment block ("COVERAGE, AS A RATCHET…") with no blank line separating them, and the job that finally appears at line 373 is `coverage:`. The job the first block actually describes, `ci-pass:`, is at line 518 and carries no comment of its own. Line 320's "Nothing else is tolerated — see the step below" points at a step 204 lines away. In a 558-line YAML file this is exactly the kind of thing that gets a contributor editing the wrong job, or reading `coverage:`'s `if:` semantics off a paragraph written about `ci-pass:`.

**Evidence.** Read .github/workflows/ci.yml lines 305-340 with line numbers — confirmed lines 310-331 are the `ci-pass` narrative, line 332 begins the coverage narrative with no blank line, and the next `jobs:` key is `coverage:` at line 373. Read lines 518-524: `ci-pass:` has no preceding comment at all.

**Fix.** Move lines 310-331 down to immediately precede `ci-pass:` at line 518, leaving the "COVERAGE, AS A RATCHET" block (332-372) where it is.

> **Verifier.** Verified line by line. .github/workflows/ci.yml:310 is `# THE ONE REQUIRED CHECK.`, and 310-331 is the ci-pass narrative (branch protection by name, `needs: [e2e]` covering the whole matrix, `if: always()` being load-bearing). Line 320 does read "Nothing else is tolerated — see the step below". Line 332 begins `# COVERAGE, AS A RATCHET RATHER THAN A NUMBER ON A BADGE.` with no blank line separating the two blocks. The next job key is `coverage:` at line 373. `ci-pass:` is at line 518 with `name: CI pass`, `if: always()`, `needs: [commitlint, ci, e2e, coverage]` and no preceding comment of its own. File is 558 lines. Nothing in AGENTS.md or CONTRIBUTING.md sanctions this placement — it is a straightforward misattachment, not taste.

### All three apps' eslint.config.js re-declare an `ignores` array that is already, verbatim, in the shared base

**Redundancy** · ~12 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/apps/web/eslint.config.js:6`
- `/home/user/afrikaburn-contributors-app/apps/org/eslint.config.js:6`
- `/home/user/afrikaburn-contributors-app/apps/suppliers/eslint.config.js:6`
- `/home/user/afrikaburn-contributors-app/packages/eslint-config/index.js:26`

`packages/eslint-config/index.js` lines 26-34 already ignore `**/.next/**`, `**/out/**`, `**/dist/**` (plus node_modules and migrations). Each of the three apps then spreads that base and appends a second config object re-declaring the exact same three globs — a pure no-op. The three app files are byte-for-byte identical to each other. The effect is that a contributor changing the ignore set now has four places to look and no way to tell which one is authoritative; the two package-level configs (`export default base`) prove the append was never necessary.

**Evidence.** Read all nine eslint.config.js files and packages/eslint-config/index.js. `diff apps/org/eslint.config.js apps/web/eslint.config.js` → identical. index.js:28-30 lists `"**/.next/**", "**/out/**", "**/dist/**"` — the same three strings as apps/web/eslint.config.js:6.

**Fix.** Reduce the three app configs to `export default base;` (matching packages/\*), or if the append exists for a future app-specific rule, drop the redundant globs and keep only genuinely app-local entries. e2e/eslint.config.js:6 is a legitimate append (`playwright-report/**`, `test-results/**`) and should stay.

> **Verifier.** Read all nine eslint.config.js files plus the base. packages/eslint-config/index.js:26-34 is a global-ignores config object listing exactly `**/.next/**`, `**/out/**`, `**/dist/**`, `**/node_modules/**`, `**/migrations/**`. apps/web, apps/org and apps/suppliers eslint.config.js are byte-for-byte identical to each other (8 lines) and their line 6 re-declares the first three of those globs verbatim — in flat config an appended object containing only `ignores` is a global ignore, so re-adding an already-ignored superset glob is a genuine no-op, not a scoping difference. The five package configs (`export default base;`) prove the append is unnecessary. e2e/eslint.config.js:6 does add `playwright-report/**` and `test-results/**`, which the finding itself correctly exempts. Size 12 lines (3 files x 4) is exact.

### `vercel-build` is a byte-identical copy of `build` in all three apps — two scripts that must be changed together, with nothing enforcing it

**Redundancy** · ~3 lines · confidence: high

Sites:

- `/home/user/afrikaburn-contributors-app/apps/web/package.json:9`
- `/home/user/afrikaburn-contributors-app/apps/org/package.json:9`
- `/home/user/afrikaburn-contributors-app/apps/suppliers/package.json:9`

In each app, line 8 (`build`) and line 9 (`vercel-build`) are the same string: `pnpm --filter @quagga/db db:migrate:deploy && next build`. Vercel falls back to `build` when `vercel-build` is absent, so the second script buys nothing — but it does create a divergence trap: someone changing the build command locally will edit `build`, CI (`turbo run build`) will pick it up, and the deployed build will silently keep running the old command from `vercel-build`. Given AGENTS.md rule #1 makes this command the thing that applies production migrations, a silent divergence here is expensive. Nothing in docs/deploy.md or any workflow references `vercel-build`.

**Evidence.** `grep -rn 'vercel-build'` across the repo (excluding node_modules/lockfile) → exactly three hits, the three package.json:9 lines, with no consumer. Read all three package.json files: lines 8 and 9 are character-identical within each.

**Fix.** Delete the `vercel-build` script from all three apps and let Vercel use `build`. If it is retained for a reason not recorded anywhere, add a one-line comment in docs/deploy.md saying so.

> **Verifier.** Confirmed exactly. In apps/web, apps/org and apps/suppliers package.json, line 8 (`build`) and line 9 (`vercel-build`) are both the character-identical string `pnpm --filter @quagga/db db:migrate:deploy && next build`. Repo-wide `grep -rn vercel-build` (excluding node_modules/lockfile) returns exactly those three lines and no consumer — no workflow, no doc, no vercel.json. The divergence trap is real and slightly worse than stated: docs/deploy.md:97-99 says "Build command: leave default — each app's `build` script already runs `db:migrate:deploy && next build`. **Do not remove the migrate step.**", which describes `build` while Vercel's default resolution actually prefers `vercel-build` when present. Combined with AGENTS.md hard rule #1 making this the command that applies production migrations, the hazard is concrete. Size 3 lines is exact.

---

## Test suites and e2e

_The test suites are, on the whole, unusually good — this is a repo where the tests are documented better than most production code. I scanned every `it()`/`test()` block in the monorepo for a missing `expect` and found ZERO, so the recent "coverage floors above 60%" commit (cf52c28) was not bought with assertion-free execution; the new packages/types, packages/auth and packages/ui suites assert on returned values and messages throughout. I read the e2e specs that looked like duplicates by filename and confirmed they are not: e2e/specs/god/camp-categories-crud.spec.ts vs e2e/specs/org-staff/camp-categories-crud.spec.ts are the CRUD half and the read-only-refusal half of the same rule, and e2e/specs/org-staff/account-suite.spec.ts vs e2e/specs/supplier/account-suite.spec.ts share a filename and nothing else. Same for the cross-package pairs (types vs core audience.test.ts, bio.test.ts, questionnaire-grid.test.ts) — schema validation vs resolution logic, correctly separated. e2e/personas has no spec files at all, so there is no personas/-vs-specs/ duplication; the only near-duplicate specs live in e2e/tests/ (finding #4). I checked for test-only exports leaking into production modules and found none. Where the area genuinely hurts is convergence: four incompatible DB fakes (finding #1) is the structural problem the other findings hang off — the vacuous web tests in finding #5 are only possible because the weakest of the four guards the participant app, and the same "each workspace invented its own" instinct produced the duplicated email tests, the duplicated e2e officer helpers and the triplicated vitest configs. Two smaller inconsistencies I did not raise as findings: e2e/specs/org-staff/\_helpers.ts is the only persona helper module not named support.ts (the other six are), and its `desktopOnly()` helper is reachable only from org-staff/ so e2e/specs/god/camp-categories-crud.spec.ts:14-19 hand-rolls the same mobile-360 skip inline._

### apps/org/lib/**tests**/email.test.ts is 162 verbatim lines of apps/web's email test, guarding a module that is itself a byte-identical twin

**Redundancy** · ~300 lines · confidence: high

Sites:

- `apps/org/lib/__tests__/email.test.ts:19-180`
- `apps/web/lib/__tests__/email.test.ts:13-174`
- `apps/org/lib/email.ts:4-7`
- `apps/web/lib/email.ts:1-126`

apps/org/lib/email.ts and apps/web/lib/email.ts differ by exactly four comment lines — the comment apps/org/lib/email.ts:4-7 says so itself ("BYTE-IDENTICAL TWIN of apps/web/lib/email.ts. Keep them in lockstep"). The tests were then copied to match: lines 19-180 of the org test are character-for-character lines 13-174 of the web test, and the org file's own header at :13-18 admits it ("PORTED, NOT INVENTED... This file is `apps/web/lib/__tests__/email.test.ts` with the org-specific cases added at the end"). Only the org file's trailing `describe("sendEmail — the rest of the contract")` block (:181-310) is new — and every case in it (batch response shape, thrown fetch, HTML escaping, provider refusal, empty recipient list, isEmailConfigured) applies equally to the web copy, which does not have them. So the duplication is not even symmetric: the web module has strictly weaker coverage of identical code.

**Evidence.** `diff -u apps/web/lib/email.ts apps/org/lib/email.ts` → one hunk, four added comment lines. `diff` of `sed -n '13,178p' apps/web/lib/__tests__/email.test.ts` against `sed -n '19,184p' apps/org/lib/__tests__/email.test.ts` → identical for the first 162 lines, differing only where the org file continues.

**Fix.** Move the Resend seam into a shared package (packages/core already exports the security-email copy builders it uses) and keep ONE test suite — the org file's superset. Both apps then import it and both get the batch-shape / escaping / refusal cases. Roughly 126 source lines and 174 test lines disappear.

> **Verifier.** Independently reproduced both diffs. `diff -u apps/web/lib/email.ts apps/org/lib/email.ts` yields exactly one hunk of four added comment lines (apps/org/lib/email.ts:4-7, which literally says 'BYTE-IDENTICAL TWIN of apps/web/lib/email.ts. Keep them in lockstep'). `diff <(sed -n '13,174p' web/email.test.ts) <(sed -n '19,180p' org/email.test.ts)` exits 0 — 162 character-identical lines. The org header at :14-18 admits the port ('PORTED, NOT INVENTED... This file is apps/web/lib/**tests**/email.test.ts with the org-specific cases added at the end'), and the superset block `describe("sendEmail — the rest of the contract")` begins at org:187 and runs to the file end at 310, absent from the web copy (174 lines). Size 300 = 126 source + 174 test, accurate.

### Three e2e helpers are implemented twice under different names in camp-lead/support.ts and officer/support.ts, and the copies have already drifted apart

**Redundancy** · ~60 lines · confidence: high

Sites:

- `e2e/specs/camp-lead/support.ts:255-291`
- `e2e/specs/camp-lead/support.ts:301-351`
- `e2e/specs/officer/support.ts:149-190`
- `e2e/specs/officer/support.ts:198-216`

Three pairs drive the identical UI flow under different names. (1) `assignOfficer` exists in BOTH files with the same signature and the same steps — goto /camps/<slug>/settings/roles, expand the officer accordion by name, pick the member in the combobox, click "ask them to accept", assert awaiting-acceptance — differing only in locator robustness. (2) `acceptOfficerRequest` (camp-lead:282) and `respondToConsent` (officer:174) both click the consent banner, and they ALREADY DISAGREE about its heading: /asked to be a camp officer/i vs /you've been asked to be a camp officer/i. (3) `openRegistrationInConsole` (camp-lead:301) and `openOrgRegistration` (officer:198) are the same MAX_PAGES=25 pagination loop over /registrations?page=N with the same click / waitForURL / return-url / "no registrations" break / throw. The camp-lead copy additionally detects the staff gate and says so, and its comment records that the missing version of that diagnostic cost a measured six-test misdiagnosis on 29 Jul 2026 — the officer copy still lacks it, so officer specs get exactly the misleading "never appeared in the queue" message the incident produced. This is not a persona-boundary: `openRegistrationInConsole` is already imported cross-folder by e2e/specs/god/department-domain-scoping.spec.ts:41, e2e/specs/org-staff/medical-notes-access.spec.ts:35 and e2e/specs/org-staff/wrangler-assignment.spec.ts:31.

**Evidence.** Read all six functions side by side. `grep -rn "assignOfficer|acceptOfficerRequest|respondToConsent|openRegistrationInConsole|openOrgRegistration" e2e --include=*.ts` shows officer/\* importing only the officer copies and camp-lead/god/org-staff importing the camp-lead copies. Regex divergence confirmed at camp-lead/support.ts:287 vs officer/support.ts:184.

**Fix.** Delete officer/support.ts's `assignOfficer`, `respondToConsent` and `openOrgRegistration`; import camp-lead/support.ts's versions (adding an `accept | decline` argument to `acceptOfficerRequest`). Better still, lift the three shared ones out of camp-lead/ into e2e/personas/ since they are already cross-persona. Officer specs inherit the staff-gate diagnostic for free.

> **Verifier.** Every line number is exact: camp-lead/support.ts assignOfficer:255, acceptOfficerRequest:282, openRegistrationInConsole:301; officer/support.ts assignOfficer:149, respondToConsent:174, openOrgRegistration:198. Read all six side by side — assignOfficer has an identical signature and identical step sequence (roles settings, expand accordion by officer name, combobox, option by member name, 'ask them to accept', awaiting-acceptance assertion); openOrgRegistration is the same MAX_PAGES=25 loop over /registrations?page=N with the same click/waitForURL/return-url/'no registrations' break/throw, missing only the staff-gate diagnostic whose comment records the 29 Jul 2026 six-test misdiagnosis. The persona-boundary defence is refuted: grep confirms openRegistrationInConsole is already imported cross-folder at god/department-domain-scoping.spec.ts:41, org-staff/medical-notes-access.spec.ts:35 and org-staff/wrangler-assignment.spec.ts:31. Two corrections to the write-up, neither fatal: the two consent regexes do not actually conflict — /asked to be a camp officer/i is a SUPERSET of /you've been asked to be a camp officer/i, so 'ALREADY DISAGREE' overstates it; and respondToConsent is strictly richer than acceptOfficerRequest (accept|decline arg plus a banner-cleared assertion), which the proposed fix does acknowledge. ~68 lines in officer/support.ts are the deletable side, so the 60-line estimate is fair.

### Two of the three tests in e2e/tests/negative-paths.spec.ts are already proven by specs/, and each duplicate costs two browser runs

**Redundancy** · ~40 lines · confidence: high

Sites:

- `e2e/tests/negative-paths.spec.ts:46-79`
- `e2e/specs/anon/org-console-refused.spec.ts:16-38`
- `e2e/specs/org-staff/access-and-gate.spec.ts:14-38`

negative-paths.spec.ts:46 ("anonymous is refused the org console") is the same four assertions as org-console-refused.spec.ts:16 — goto /registrations, /restricted to afrikaburn staff/i visible, sign-in link visible, registration heading toHaveCount(0) — differing only in the last regex. negative-paths.spec.ts:64 ("a non-org burner is refused the org console") is a strict subset of access-and-gate.spec.ts:14, which does the same signUpBurner + signInAs + goto /registrations + /this side is for afrikaburn staff/i + /registration pipeline/i toHaveCount(0) and then additionally walks four more console surfaces. Only the third test in the file (:81, the registry-completeness gate that fails when a forbidden capability id appears in no spec) is unique and genuinely valuable. Because playwright.config.ts runs both a desktop-chromium and a mobile-360 project over testDir ".", the two duplicates are four redundant browser runs — including a full participant sign-up and onboarding for the second — on a suite AGENTS.md already describes as the slow gate.

**Evidence.** Read all three files in full and compared assertion by assertion. Test titles pinned with grep -n. playwright.config.ts `testDir: "."` plus the two `projects` entries confirms both files are collected on both viewports.

**Fix.** Delete the two browser tests from e2e/tests/negative-paths.spec.ts, keeping the registry-completeness meta-test (which needs no page at all and already excludes its own file from the corpus at :112). Note the surviving spec that proves each capability id, since the negative-paths header already maintains exactly that index.

> **Verifier.** Read all three files. negative-paths.spec.ts:46-62 is the same goto /registrations + /restricted to afrikaburn staff/i + ^sign in$ link + registration-heading toHaveCount(0) as anon/org-console-refused.spec.ts:16-38, differing only in the heading regex (/registration/i vs /registration pipeline/i, where the spec's comment records that the narrower one was chosen deliberately after the tautology fix). negative-paths.spec.ts:64-79 is a strict subset of org-staff/access-and-gate.spec.ts:14-38: identical signUpBurner({onboard:true}) + signInAs(orgPage,...,'org') + goto /registrations/ + /this side is for afrikaburn staff/i + /registration pipeline/i toHaveCount(0), and access-and-gate then walks four more console surfaces. playwright.config.ts confirms `testDir: "."` (:24) with projects desktop-chromium (:69) and mobile-360 (:77), so both duplicates run twice. Deletion is safe for the registry gate: the surviving spec titles carry [reach-org-console], and the gate excludes negative-paths.spec.ts from its own corpus at :111. The two tests span 46-79 (34 lines), close enough to the claimed 40.

### Several apps/web tests only prove the mock returns what the test queued — a direct consequence of the weakest of the four DB fakes

**Simplification** · ~15 lines · confidence: high

Sites:

- `apps/web/lib/__tests__/lib-primitives.test.ts:301-306`
- `apps/web/lib/__tests__/groups-store.test.ts:194-198`
- `apps/web/lib/groups-store.ts:59-70`
- `apps/web/lib/db.ts:10-12`
- `apps/web/lib/__tests__/lib-primitives.test.ts:24`

`it("db() hands out a usable query builder")` queues [{id:"x"}], calls `db().select()` and asserts it equals [{id:"x"}]. But `db()` is one line — `return createHttpDb()` — and `createHttpDb` is mocked at lib-primitives.test.ts:25 to return `harness.handle`, so the test asserts the fake's own `then` behaviour and cannot fail unless the fake breaks. `it("returns the edition's catalog rows")` has the same shape: it queues one row and asserts `listCampCategories(EDITION)` returns it. Because apps/web/test/db-mock.ts resolves queued values verbatim (`nextResult()` at :110, `then` at :137-147) with no projection and no predicate exposure, deleting `.where(eq(schema.campCategories.editionId, editionId))` at groups-store.ts:69, swapping the table, or changing the projection all leave that test green. Both are pure coverage. This is exactly the trap AGENTS.md:242 names ("A test that passes for the wrong reason is worse than no test, because it is counted"), and both surrounding suites contain excellent tests, which makes these harder to spot, not easier. Note that apps/org's fake applies the projection SPECIFICALLY so this cannot happen (its header at :23-33 explains why) and apps/suppliers' compiles real SQL — the web app is the only workspace where the shape is possible.

**Evidence.** Read apps/web/lib/db.ts (db() is `return createHttpDb();`), the vi.mock factory at lib-primitives.test.ts:19-37, the two test bodies, `listCampCategories` at groups-store.ts:59-71, and DbMock.nextResult/then at db-mock.ts:110-114 and :137-147. Separately scanned every it()/test() block in the repo for a missing `expect` — none, so coverage was NOT bought with assertion-free tests; this shape is the residue instead.

**Fix.** Delete `db() hands out a usable query builder` outright (a one-line delegation with no branch). Give `listCampCategories` a real claim by asserting on `dbMock.onlyQuery("select")` — that it filtered on the edition and ordered by sort then label — the way the neighbouring `listDirectory` tests already assert `dbMock.queries` length. Fixing finding #1 removes the class.

> **Verifier.** Both tests are where claimed and are what is claimed. lib-primitives.test.ts:301-306 queues [{id:'x'}] and asserts db().select() equals it; apps/web/lib/db.ts:10-12 is `export function db() { return createHttpDb(); }` and createHttpDb is replaced with `() => harness.handle` at lib-primitives.test.ts:24 inside the vi.mock('@quagga/db') factory, so the assertion lands on DbMock's own `then` (db-mock.ts:137-147 resolving nextResult() at :110-114). groups-store.test.ts:194-198 queues one row and asserts listCampCategories(EDITION) returns it verbatim; groups-store.ts:59-70 returns the builder result unmapped, so with no projection applied and no predicate asserted, deleting the `.where(eq(schema.campCategories.editionId, editionId))` at :69 or the orderBy at :70 leaves it green. The AGENTS.md quote is real — line 242 reads 'A test that passes for the wrong reason is worse than no test, because it is counted.' The proposed fix preserves behaviour: the second test gains a real claim via dbMock.onlyQuery('select') rather than losing one, and the first covers a branchless one-line delegation. ~15 lines is right.

### Two dead exports in e2e/personas/registry.ts, one advertising a meta-test that does not exist

**Dead code** · ~10 lines · confidence: high

Sites:

- `e2e/personas/registry.ts:331-337`

`ALL_CAPABILITIES` (:332) carries the comment "Every distinct capability, for a completeness meta-test" — there is no such meta-test, and the constant has zero references anywhere in the repo including e2e/, docs/, scripts/ and the README's helper table. The completeness gate that DOES exist (e2e/tests/negative-paths.spec.ts:81) iterates `forbiddenMatrix()` instead. `persona(kind)` (:335) likewise has no call site; specs reference capability ids as string literals in their titles, and e2e/README.md:179 documents `PERSONAS[kind]` directly. A comment promising a test that was never written is worse than no comment: the next contributor either goes looking for it or writes a second one.

**Evidence.** `grep -rn "ALL_CAPABILITIES" e2e docs scripts` → one hit, the definition itself. `grep -rn "persona(" e2e --include=*.ts | grep -v registry.ts` → no hits. `grep -rn "PERSONAS|PersonaSpec|forbiddenMatrix" e2e docs` → forbiddenMatrix used only by negative-paths.spec.ts:43,117; PERSONAS named only in e2e/README.md:179.

**Fix.** Delete both exports and the stale comment. If the completeness meta-test is still wanted, write it next to the forbidden-capability gate in negative-paths.spec.ts rather than leaving a constant that implies it exists.

> **Verifier.** Verified with my own repo-wide greps, not the auditor's. `grep -rn ALL_CAPABILITIES` excluding node_modules and .git over the WHOLE repo returns exactly one line — the definition at e2e/personas/registry.ts:332, carrying the comment 'Every distinct capability, for a completeness meta-test' at :331. `grep -rn '\bpersona('` over the whole repo minus registry.ts returns nothing, so the `persona(kind)` helper at :335-337 has no call site; e2e/README.md:178-179 documents `PERSONAS[kind]` and `forbiddenMatrix()` directly and never mentions either export. Neither is a framework entrypoint, a string-referenced config value, or a barrel re-export — e2e/personas/registry.ts is a plain module imported only by e2e/tests/negative-paths.spec.ts:43, which imports forbiddenMatrix alone. The only completeness gate that exists (negative-paths.spec.ts:81-127) iterates forbiddenMatrix(). ~8-10 lines including comments, as claimed.

---

## Refuted findings

Raised by an auditor and struck down on verification. Recorded so nobody re-raises them.

### Two independent QuestionnaireBuilder implementations serialise the same five field kinds into the same shared type

_Area: web-app_

REFUTED on two independent grounds. (1) The org half of the pair is not live code. `grep -rn "QuestionnaireBuilder\b" apps/org` returns exactly one hit — the definition at apps/org/components/questionnaire/builder.tsx:181. Nothing imports "@/components/questionnaire/builder" anywhere in apps/org; the console's real builder is QuestionnaireBuilderV2 in apps/org/components/questionnaires/builder-v2.tsx, used by (console)/questionnaires/new/page.tsx:22 and [key]/edit/page.tsx:45. So the claimed maintenance hazard ("adding a sixth kind means editing two files in two apps") is false — editing the org file changes nothing that ships. (2) Even taking the files at face value they are not duplicates: `diff` gives 902 changed lines against only 101 common lines across the two 584/542-line files. And by the finding's own evidence the serialisers behave differently on purpose — org slugifies option values and sets maxLength 200/2000, web keys options by local id and emits no maxLength — so the proposed lift into @quagga/core would change stored data shape in at least one app, not preserve behaviour. Superficial shape similarity (five kind names) is not duplication.

### The org-permissions 5x5 resolution matrix is encoded three times in one test file

_Area: packages-core-types_

Only one of the three claimed restatements holds up, and the proposed fix would delete coverage. (a) "MIGRATES the old ranks unchanged" (lines 234-248, ~15 lines) is genuinely redundant — its 8 assertions are all generated by the MATRIX loop at 223-233 for ACTORS.seeded_engineer / seeded_org_staff. That part is real, though the test's own comment frames it as a deliberate canary in a security file. (b) The two `staffOnly` computations are NOT "the same fact twice". At line 300 it compares actor("org_staff",[seeded]) vs actor("engineer",[seeded]); at line 329 it compares two actors each holding `orgPermissionsFromKeys([...ORG_CAPABILITIES])`. MATRIX contains a `widened_engineer` row but has NO widened org_staff row, so the second computation is the only place asserting that a maximally-granted org_staff actually resolves delete and personal_information — i.e. that the engineer carve-out is a hard ceiling rather than an artefact of what the seeded role happens to grant. "Fold the duplicate staffOnly out of THE ENGINEER TIER" drops that case. (c) With only MIGRATES genuinely removable, the real size is ~15 lines against a claimed 40 — inflated ~2.7x.

### Four incompatible drizzle-DB fakes (~970 lines) do the same job, one per workspace, and each one's header argues the others are wrong

_Area: tests-e2e_

The counts and quotes check out (973 lines total; suppliers/db.ts:8 and :13, web/db-mock.ts:13-16 and :110-114/:137-147, org/fake-db.ts:23-33/:140-147/:255-265 all say what is claimed; importers are 14 web / 16 org / 10 suppliers / 2 db = 42, not 44). But this fails the redundancy test the audit is making. `diff` across the four shares essentially nothing — the finding itself concedes they are 'mutually incompatible rather than merely divergent'. They are four DIFFERENT designs with different capabilities, not copies: apps/web's models queued Errors as REJECTIONS to drive the 23505 unique-violation branches (`uniqueViolation()` at :247) and models nested savepoints with `tx:` marking, neither of which the suppliers pg-proxy fake does; packages/db's is used only by packages/db's own tests, so the proposed shared `packages/test-db` built on the suppliers design (which imports `schema` and `Database` from `@quagga/db`) would be a dependency cycle for packages/db itself. A load-bearing sub-claim is also false: apps/web's fake DOES expose predicate values — `boundStrings()` at db-mock.ts:227 plus `RecordedQuery.arg("where")` at :122, and boundStrings is used for exactly that in 8 test files (account-sanitize-runner, bio-store-projection, invites-store, notifications-inbox, project-registration-store, questionnaire-store). 'Each one's header argues the others are wrong' is 2 of 4 (web's and packages/db's headers argue with nobody), and web's header documents its own limitation deliberately ('Do not read a green suite here as "the SQL is right"'). The proposed fix is not a deduplication but a behaviour-changing rewrite of 42 test files' assertion vocabulary.

### Three byte-identical server-only stubs and three near-identical vitest coverage configs must be edited in parallel to change one thing

_Area: tests-e2e_

The stubs are genuinely identical (diff of all three pairs is empty, 5 lines each) and oxc is genuinely absent from apps/web (present at apps/org/vitest.config.ts:18 and apps/suppliers/vitest.config.ts:13, not :16/:11). But the load-bearing consequence is false: apps/web has ZERO .tsx files under lib/ (`find apps/web/lib -name '*.tsx'` is empty; only apps/org/lib/gate.tsx and apps/suppliers/lib/gate.tsx exist), so nothing is silently vanishing from apps/web's coverage table and the trap is latent-if-someone-adds-a-tsx, not 'live'. The size is also inflated well past 2x. The three configs are 101/102/80 lines, and what a shared helper could actually absorb is the 5-line stub twice plus a ~10-line kernel (environment, include, provider, reporter, reportOnFailure, coverage include, alias pair) twice, plus the one near-verbatim 3% sentence — roughly 45 lines, not 120. Everything else is per-app and NOT duplication: the excludes differ materially (web excludes lib/auth-client.ts with a documented rationale, org excludes \*_/_.d.ts, suppliers excludes neither), the thresholds and per-file floors differ, and the 'essays' are each app's own measured record — org's names its three misleading 100%s, suppliers' explains why its withTransaction sits honestly at 20% and explicitly contrasts that with apps/org's mocked 100%. Consolidating those would delete knowledge, not duplication.
