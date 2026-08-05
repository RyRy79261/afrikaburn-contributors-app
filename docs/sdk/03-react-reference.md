## `@afrikaburn/react` — the React package reference

Ships in **v0.2** ("an integrator can act for a camp"). v0.1 is `@afrikaburn/sdk` only.
This shard is the contract for the React bindings: what they render, what they fetch,
what they cache, and — the part that matters — what they are structurally incapable of
leaking.

---

### 1. What this package is

`@afrikaburn/react` is a **rendering layer over a document**. It contains no
authorisation logic. Every allow/deny it renders was decided server-side by
`orgCanInDomain` / `hasProjectPermission` / `summarizeOrgActor` and serialised into the
capability manifest (§3.2 of the decision). The hooks read that document; the components
render what the hooks return.

Three consequences, stated up front because every design choice below follows from them:

1. **The package never evaluates a predicate.** `packages/core/src/org-permissions.ts`,
   `packages/core/src/project-permissions.ts` and `packages/core/src/privacy.ts` stay FSL
   and stay in the repo. Nothing in `node_modules` on an integrator's machine knows that
   `manage_roles` implies `assign_roles` — that implication is materialised once,
   server-side, into `CampGrant.permissions` (`packages/core/src/project-permissions.ts:53`
   is the one line; two implementations of it is the failure this design exists to avoid).
2. **The package never holds an API key.** There is no `apiKey` prop, no `apiKey` option,
   no `apiKey` field in any exported type. §8 below is the enforcement, not the request.
3. **Gating is an affordance, never the boundary.** This is `AGENTS.md` rule 7 restated at
   a new frontier: hiding a control in the UI is never the security boundary. Clerk's own
   docs say the same thing about `<Show>`: "This component only **visually hides** its
   children. The contents of its children remain accessible via the browser's source code
   even if the user fails the authentication/authorization check" — verified at
   `clerk/clerk-docs` `docs/reference/components/control/show.mdx`; the clerk.com rendering
   of that page 403s to automated fetches. The server re-runs the identical guard on every
   call regardless of what `<Can>` rendered.

**Rejected:** a React package that ships the predicate kernel so gating works offline with
no manifest. Rejected because a pinned Apache copy of the kernel in strangers'
`node_modules` reintroduces the second permissions table that
`packages/core/src/org-permissions.ts:20-25` deleted on principle — separated by a version
axis nobody controls instead of by a file.

---

### 2. Install, peers, entry points

```bash
pnpm add @afrikaburn/sdk @afrikaburn/react @tanstack/react-query
```

| Dependency              | Kind                                   | Range              | Why                                                                                                                                                              |
| ----------------------- | -------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@afrikaburn/sdk`       | dependency                             | exact same version | Rights are one type in one version. A `react@2` + `sdk@1` lockfile gates against the wrong vocabulary.                                                           |
| `react`                 | **peer**                               | `^19`              | Repo pins `^19.2.6` (`apps/web/package.json:29`, `packages/ui/package.json:43`). A published package must not bundle React — two copies break context and hooks. |
| `react-dom`             | peer                                   | `^19`              | Same.                                                                                                                                                            |
| `@tanstack/react-query` | **peer**                               | `^5`               | Decision 24. Manifest TTL + version-invalidation + SSR hydration _is_ TanStack Query; writing it is writing it badly.                                            |
| `msw`                   | optional peer, `/testing` subpath only | `^2`               | §11.                                                                                                                                                             |

**Divergence from repo precedent, deliberate:** `packages/ui/package.json:43-44` declares
`react` and `react-dom` as **dependencies**, not peers. That is correct for a private
workspace package consumed only through `transpilePackages`
(`apps/web/next.config.ts`) and wrong for a published one. Do not copy it.

Entry points:

```jsonc
// @afrikaburn/react — exports
".":         "\"use client\" bindings: provider, hooks, gating components.",
"./server":  "RSC-safe. `import 'server-only'`. Manifest fetch + delegation minting helpers.",
"./testing": "Mock client, manifest fixture builder, MSW handler factory. Never in a production bundle."
```

`"sideEffects": false`. `"use client"` directives are preserved by tsdown's rolldown output
(decision 27) — this is the reason tsdown was chosen over esbuild-based bundlers, and it
matters here more than anywhere: 34 of the 89 source files under `packages/ui/src` carry
`"use client"` (29 of the 54 entries in `packages/ui/src/components`), and this package will
have the same shape.

---

### 3. The two credentials — there is no publishable key

**Decision 17 rejected a publishable key.** This section states the split that replaced it,
because "publishable vs secret" is the wrong mental model to bring to this SDK and an
integrator who brings it will build something unsafe.

|                    | Secret API key                                                                  | Delegation token                                                                      |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Format             | `qg_live_<start><secret>`                                                       | opaque bearer, JWT-shaped or opaque (server's choice)                                 |
| Where it may exist | `@afrikaburn/sdk/server` only — RSC, route handler, server action, Node process | anywhere, including a browser                                                         |
| Lifetime           | until rotated                                                                   | **≤ 10 minutes**, audience-bound                                                      |
| Rights             | the key's ceiling ∩ live subject resolution                                     | **narrowing only** — a subset of the minting key's effective scopes, never a superset |
| Minted by          | an operator, in the Integrations console (v1.0)                                 | `ab.delegate.mint()` on the server, per render                                        |
| Revocation         | `enabled=false`, or `integrations.status='suspended'`                           | expiry; plus the next manifest fetch fails                                            |

**Why not a publishable key.** The rejected design pinned an `ab_pk_live_*` key to an
`Origin` header. `curl -H 'Origin: …'` defeats that in one line. And the scope it would
most obviously carry — `public:profiles:read` → `publicBioView`
(`packages/core/src/bio.ts:359`, reached via `apps/web/lib/groups-store.ts:626
getPublicBurnerProfile`) — carries `legalName`, `homeCity` and `contactEmail` fields, each
returned when the burner set that privacy flag to `true` (`show()` = `canBePublic(key) &&
privacyFlags[key] === true`, `bio.ts:364-365`). Opt-in per field or not, a credential-free
bulk-enumeration endpoint over Burn identities is not a DX convenience.

**The browser therefore never authenticates directly.** It holds a short-lived delegation
token minted for it by the integrator's own server, on the integrator's own origin. If an
integrator has no server, they have no browser client — they call the SDK from their
backend and render the result. That is the honest answer and the README says it in those
words.

---

### 4. Provider setup

#### 4.1 The shape of the handoff

```
RSC (integrator's server)                  browser
──────────────────────────────             ──────────────────────────
createServerClient({ apiKey })   ─┐
  ab.manifest.fetch()             │  manifest (plain JSON)
  ab.delegate.mint({ scopes })    ├─►  delegation grant  ──►  <AfrikaBurnProvider>
                                  │                             useCan() is SYNCHRONOUS
                                  └─  key NEVER crosses          on first render
```

The manifest is plain JSON — every field in the `Manifest` interface (decision §3.2) is a
string, number, boolean, array or plain object. It crosses the RSC boundary as an ordinary
prop. No `<script>` injection, no `dangerouslySetInnerHTML`, no serialiser of our own.

#### 4.2 `<AfrikaBurnProvider>`

```tsx
"use client";

export interface AfrikaBurnProviderProps {
  /**
   * The capability manifest, fetched server-side and passed down. Required.
   * There is no client-only "fetch it yourself" mode: without a manifest the
   * first render cannot answer useCan(), and a gating layer that flickers from
   * denied → granted teaches users the UI is lying.
   */
  manifest: Manifest;

  /**
   * The browser's credential. Narrowing-only, ≤10 min, audience-bound.
   * Omit for a read-only render that makes no client-side calls (SSR-only
   * pages, static camp directories) — hooks still answer, mutations throw
   * `NoCredentialError`.
   */
  delegation?: DelegationGrant;

  /**
   * A SERVER ACTION that mints a fresh delegation grant (and manifest).
   * Called when `delegation.expiresAt` is within `refreshLeewaySeconds`, and
   * when the transport sees a manifest-version mismatch. Must be a server
   * action or a route on the integrator's own origin — it is the only thing in
   * the browser's world that can reach the API key.
   */
  refresh?: () => Promise<DelegationGrant>;

  /** Default 60. Refresh fires this many seconds before expiry. */
  refreshLeewaySeconds?: number;

  /**
   * Supply your own QueryClient to share a cache with the rest of the app.
   * When omitted the provider creates one scoped to itself.
   */
  queryClient?: QueryClient;

  /** Dev-only. Mounts <RightsInspector> behind a keyboard shortcut. */
  inspector?: boolean;

  children: React.ReactNode;
}

export declare function AfrikaBurnProvider(
  props: AfrikaBurnProviderProps,
): React.JSX.Element;

export interface DelegationGrant {
  token: string;
  expiresAt: string; // ISO 8601
  audience: string; // the origin this token is bound to
  manifest: Manifest; // the NARROWED manifest for this token
}
```

The provider mounts, in order: a `QueryClientProvider` (its own or yours), a
`RightsContext` holding the manifest, and a transport bound to the delegation token. It
renders nothing of its own.

**`manifest` is required and `delegation` is not.** That asymmetry is the point: the rights
document is cheap, serialisable and safe to render from; the credential is expensive and
dangerous. A page that only _displays_ what a key could do needs no credential at all.

#### 4.3 `<RightsHydrator>` — the RSC seam

`AfrikaBurnProvider` is a client component and cannot be rendered from an RSC that wants to
stay server-only for the rest of its tree. `<RightsHydrator>` is the thin server component
that fetches, mints, and hands off:

```tsx
// @afrikaburn/react/server
import "server-only";

export interface RightsHydratorProps {
  client: ServerClient; // from @afrikaburn/sdk/server
  /** Scopes the browser half is allowed to use. NARROWING ONLY — the server rejects a superset. */
  delegate?: readonly Scope[];
  /** Camp allowlist for the delegation. Omit for org/self/public-only pages. */
  groupIds?: readonly string[];
  ttlSeconds?: number; // ≤ 600, default 600
  refresh?: () => Promise<DelegationGrant>; // a server action, passed through
  children: React.ReactNode;
}

export declare function RightsHydrator(
  props: RightsHydratorProps,
): Promise<React.JSX.Element>;
```

It is an async server component. It calls `client.manifest.fetch()` and, when `delegate` is
present, `client.delegate.mint(...)`, then renders `<AfrikaBurnProvider>` with the results.
Children stay server components unless they say otherwise.

#### 4.4 Full wiring, App Router

```tsx
// app/layout.tsx  — RSC
import { createServerClient } from "@afrikaburn/sdk/server";
import { RightsHydrator } from "@afrikaburn/react/server";
import { refreshDelegation } from "./actions";

const ab = createServerClient({
  apiKey: process.env.AFRIKABURN_API_KEY!, // server env; never NEXT_PUBLIC_*
  scopes: [
    "public:camps:read",
    "camp:view_member_details",
    "camp:assign_roles",
  ] as const,
});

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <RightsHydrator
          client={ab}
          delegate={["camp:view_member_details", "camp:assign_roles"]}
          refresh={refreshDelegation}
        >
          {children}
        </RightsHydrator>
      </body>
    </html>
  );
}
```

```ts
// app/actions.ts
"use server";

import { createServerClient } from "@afrikaburn/sdk/server";
import type { DelegationGrant } from "@afrikaburn/react";

const ab = createServerClient({ apiKey: process.env.AFRIKABURN_API_KEY! });

export async function refreshDelegation(): Promise<DelegationGrant> {
  return ab.delegate.mint({
    scopes: ["camp:view_member_details", "camp:assign_roles"],
    ttlSeconds: 600,
  });
}
```

**Construction-time reconciliation still applies here.** `createServerClient` with a
declared `scopes` tuple diffs declared against granted at construction and throws
`ScopeContractError` in dev/CI (decision §3.4). In a Next build that surfaces as a build
failure with the missing scopes, each `Refusal.message`, the remediation URL **and the
held-scope list** — which is the line that kills the most common support ticket.

---

### 5. Hooks

Every hook in this package is synchronous against the hydrated manifest. None of them
suspends. None of them fires a request on mount. That is deliberate: a permission hook that
suspends turns every gated button into a loading state, and a UI that spends 200ms not
knowing whether you may click something is worse than one that says no.

#### 5.1 `useAfrikaBurn()`

```ts
export declare function useAfrikaBurn(): BrowserClient;
```

The delegation-bound client. Throws `MissingProviderError` outside a provider. Throws
`NoCredentialError` from any method when the provider was mounted without `delegation`.

`BrowserClient` is `AfrikaBurn<S>` with `S` inferred from nothing — the browser half is
**runtime-gated only**. Compile-time `Deny<>` gating lives on `createServerClient`'s
declared tuple (decision §3.3); a browser client's scopes are decided at mint time by a
server the type system cannot see. Pretending otherwise would be the fail-open the
`ScopeTuple` design exists to close.

#### 5.2 `useManifest()`

```ts
export interface ManifestState {
  manifest: Manifest;
  /** Wall-clock staleness. `true` past `expiresAt`; the transport is already refetching. */
  stale: boolean;
  /** Set when the server's X-AfrikaBurn-Manifest-Version disagreed with ours. */
  drifted: boolean;
  /** null until a refresh has failed. Fail-closed: gates keep the LAST KNOWN manifest. */
  error: AfrikaBurnError | null;
}

export declare function useManifest(): ManifestState;
```

There is no `refresh()` on the return value. `ab.refresh()` was cut (decision §3.5) —
three overlapping staleness hatches is two too many. Staleness is handled by the TTL and
the version header, both inside the transport.

#### 5.3 `useCan(scope, on?)` — the primary hook

```ts
export type CanVerdict =
  | { ok: true; status: "granted"; scope: Scope }
  | {
      ok: false;
      status: "hollow";
      scope: Scope;
      clause: string;
      departments: readonly { id: string; name: string }[];
    }
  | {
      ok: false;
      status: "denied";
      scope: Scope;
      mode: "explain";
      reason: RefusalReason;
      message: string;
      remediationUrl?: string;
    }
  | { ok: false; status: "denied"; scope: Scope; mode: "notFound" }
  | { ok: false; status: "pending"; scope: Scope }
  | {
      ok: false;
      status: "unavailable";
      scope: Scope;
      because: "manifest_unavailable";
    };

export interface ResourceRef {
  groupId?: string;
  slug?: string;
}

export declare function useCan(scope: Scope, on?: ResourceRef): CanVerdict;
```

`ok` is present on every arm so the common case is `if (!can.ok) return null;` while the
discriminant stays available for the cases that must be told apart. **Do not collapse this
to a boolean.** Six states, four of which need different UI:

| status                | Means                                                                              | Renders as                                                       |
| --------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `granted`             | the manifest says yes; the server will re-check                                    | the control, enabled                                             |
| `hollow`              | `OrgGrant.hollow === true` — a real grant scoped to a department that owns nothing | the control, **disabled**, with `clause`                         |
| `denied` + `explain`  | server authored an explainable refusal                                             | the control, disabled, `message` in `title` + `aria-describedby` |
| `denied` + `notFound` | knowing the resource exists is itself privileged                                   | **nothing**                                                      |
| `pending`             | client-only mount with no hydrated manifest yet                                    | a sized skeleton                                                 |
| `unavailable`         | manifest fetch failed and none was hydrated                                        | nothing (fail closed)                                            |

**`hollow` is not `granted`.** `summarizeOrgActor` (`packages/core/src/org-permissions.ts:809`)
returns `OrgCapabilityGrant[]`, and that interface distinguishes `domains: null` (org-wide)
from `domains: []` (scoped to a department owning nothing) precisely because "a summary
that overstates access to the exact person deciding whether the access is acceptable" is
the failure — the comment is on the `domains` field itself,
`packages/core/src/org-permissions.ts:766-776`. (Note `departmentIds` is _never_ `[]` —
"an empty scope is not a grant", `:761` — so `domains: []` is the only hollow signal.
Note also that today **every** capability is department-scoped:
`DEPARTMENT_SCOPED_CAPABILITIES = ORG_CAPABILITIES` at `:263-264`. The prose above it at
`:239-262` still describes the pre-CRUD vocabulary and claims only `delete` and
`read_personal_information` are scoped; that comment is stale against its own code, and
`read`/`update` grants can be hollow.) Flattening
`hollow` into `granted` reproduces the over-report; flattening it into `denied` sends the
integrator to ask for a permission they already have. It gets its own arm.

**`pending` is rare and should stay rare.** With `<RightsHydrator>` the manifest is present
on first render and `pending` never occurs. It occurs only when a consumer mounts
`AfrikaBurnProvider` client-side with a manifest they fetched themselves. During a
_refresh_ the hook keeps returning the last known verdict — it does not flip to `pending` —
because a gate that blinks on every TTL boundary is a gate people stop reading.

`on` is required for `camp:*` scopes and ignored for `org:*` / `self:*` / `public:*`, where
the domain is already inside the scope string. Passing `on` with an org scope is a dev-mode
warning, not an error.

#### 5.4 `useCanAny(scopes)` and `useCanAll(scopes)`

```ts
export declare function useCanAny(
  scopes: readonly Scope[],
  on?: ResourceRef,
): CanVerdict;
export declare function useCanAll(
  scopes: readonly Scope[],
  on?: ResourceRef,
): CanVerdict;
```

`useCanAny` exists for one specific, grounded reason: **the console's own gate asks the
org-wide question, never the domain-scoped one.** `apps/org/lib/gate.tsx:35-45` states it
outright — "A department does not decide which SCREENS open… So this gate is 'have you been
given anything at all?', asked once, and never 'does your department own this page?'" —
and `gate.tsx:54` calls `orgCan(session.actor, "read")` unscoped.

The SDK vocabulary has no unscoped `org:read` (decision 8: no wildcards, 49 literal strings
only). So the nav-item question — "should this screen be reachable at all?" — is
`useCanAny(["org:read:registrations", "org:read:suppliers", …])`. The action question stays
`useCan("org:update:suppliers")`. Two different questions with two different answers, which
is exactly the divergence `packages/core/src/org-permissions.ts:84-94` documents.

Verdict selection for `useCanAny`: first `granted` wins; else first `hollow`; else the
_narrowest_ denial (a single `notFound` among the set makes the whole set `notFound`, since
rendering an explain for a sibling scope would leak the existence the `notFound` protects).

_(spec author's call — the decision does not name a multi-scope hook. The alternative,
issuing a synthetic `org:read:_` wildcard scope, is barred by decision 8.)\*

#### 5.5 `useRefusal(scope, on?)`

```ts
export declare function useRefusal(
  scope: Scope,
  on?: ResourceRef,
): Refusal | null;
```

The raw `Refusal` record: `{ scope, reason, message, mode, remediationUrl? }`. Returns
`null` when the scope is granted, when it is `hollow`, or when the manifest carries no
refusal for it (refusals are **lazy** — decision 16 — present only for scopes in the key's
ceiling ∪ declared tuple, because an exhaustive 40-cell refusal list serialised into a
browser is the domain-ownership map).

`message` is generated server-side by `orgCapabilityRefusal`. **Its signature today is
`orgCapabilityRefusal(actor: OrgActor | null | undefined, capability: OrgCapability, domain:
OrgDomain | null = null): string` (`packages/core/src/org-permissions.ts:621-625`) — there is
no audience parameter and no `Refusal` return type.** This spec proposes adding a fourth
`{ audience: "console" | "integrator" }` option to that one generator rather than writing a
second copy table (`packages/core/src/org-permissions.ts:611-615` names that failure by name),
and the SDK assembles the `Refusal` record around the returned string. That is new surface, and
it lands in the server shard, not this one. The integrator audience must never contain a
department name or an
`ORG_DOMAIN_LABELS` value; `scopeReason` at `org-permissions.ts:602` does name the owning
department, and that arm is console-audience only.

> **Invariant worth stating because it looks like a contradiction:** `OrgGrant.departments[].name`
> _is_ in the manifest and _does_ reach the browser. Those are the key's **own** departments —
> the ones it holds. Naming your own department to you is not the org chart; naming the
> department that owns a domain you _lack_ is. The lazy-refusal rule and the integrator-audience
> generator together guarantee only the former crosses.

#### 5.6 `useCampGrant(ref)`

```ts
export interface CampGrantState {
  grant: CampGrant | null; // null = not in the manifest's camp allowlist
  /** lead/admin. A FLAG, never five scopes. */
  backstop: boolean;
  permissions: readonly CampScope[];
  questionnaires: { audienceRoles: "all" | string[]; mayBlock: boolean } | null;
}

export declare function useCampGrant(on: ResourceRef): CampGrantState;
```

`backstop: true` short-circuits the camp tier: `isPermissionBackstop` is unconditional
(`packages/core/src/project-permissions.ts:23-25`), so a lead's rights are not revocable
scopes and must not be rendered as a list of toggles. Report the flag.

`grant === null` is deliberately ambiguous between "no such camp", "a free camp you cannot
see" and "a camp that exists but this key holds nothing in". The server returns identical
bytes for all three (decision §3.6); the hook preserves that. The free-camp law is enforced
at `apps/web/lib/groups-store.ts:187` (`if (!registered && !viewerRole) continue;`) and an
SDK read must never become the implementation that gets it wrong.

#### 5.7 `useQuestionnaireVerdict()`

`manage_questionnaires` is the one permission a flat scope cannot express. It carries
`{ audienceRoles: "all" | string[], mayBlock: boolean }`
(`packages/types/src/roles.ts:280-286`), and `canManageQuestionnaireAudience` collapses
three distinct refusals into one `false` (`packages/core/src/project-permissions.ts:74-97`).

```ts
export type QuestionnaireVerdict =
  | { ok: true; activationId: string }
  | { ok: false; because: "not_granted"; reason: string }
  | {
      ok: false;
      because: "audience_out_of_scope";
      allowed: string[];
      reason: string;
    }
  | { ok: false; because: "may_not_block"; reason: string };

export interface QuestionnaireDraft {
  targetRoleIds: readonly string[];
  blocking: boolean;
}

export declare function useQuestionnaireVerdict(
  on: ResourceRef,
  draft: QuestionnaireDraft,
): { verdict: QuestionnaireVerdict | null; pending: boolean };
```

**This hook is asynchronous and it is the only one that is.** The verdict is evaluated
server-side from the same inputs `canManageQuestionnaireAudience` takes; the client reads
the answer. `not_granted` and `may_not_block` resolve locally, because those are _field
reads_ on the manifest's `questionnaires` object (`=== null`, `mayBlock === false`).
`audience_out_of_scope` goes to the server, and the reason is **§1 consequence 1, not
missing data**: §5.6 already ships `audienceRoles: "all" | string[]` to the browser, so the
subset test is computable client-side — and computing it would be a second implementation
of `canManageQuestionnaireAudience`'s union-then-subset rule
(`packages/core/src/project-permissions.ts:80-96`), which is exactly the thing this package
refuses to own. Reading a field is not evaluating a predicate; `targetRoleIds.every(id =>
allowed.has(id))` is. `verdict` is `null` while `pending`.

_(If the architect would rather this hook be synchronous, the honest way is for the server
to put a precomputed answer in the manifest — not for the client to re-derive the rule.)_

**Never a boolean.** `questionnaires` on `CampGrant` is the object or `null`.

#### 5.8 Data hooks

```ts
export declare function useAfrikaBurnQuery<T>(
  options: AfrikaBurnQueryOptions<T>,
): UseQueryResult<T, AfrikaBurnError>;

export declare function useAfrikaBurnMutation<TVars, TData, TContext = unknown>(
  options: AfrikaBurnMutationOptions<TVars, TData, TContext>,
): UseMutationResult<TData, AfrikaBurnError, TVars, TContext>;
```

`TContext` is not optional decoration: TanStack's `onMutate` return value _is_ `TContext`,
and without it the `ctx?.previous` rollback in §11.2 and §13.2 is `unknown` and does not
typecheck.

Thin wrappers over TanStack's `useQuery`/`useMutation` that (a) inject the delegation-bound
client, (b) run `assertScopes` as a **local pre-check** before the request leaves, and (c)
map `X-AfrikaBurn-Manifest-Version` drift onto a manifest invalidation. Consumers who
already have a `QueryClient` may skip these entirely and call
`useQuery(ab.groups.roster.queryOptions({ slug }))` — the query-option factories are on the
core client and are framework-agnostic (decision 24; `queryOptions()` is a typed identity
function returning a plain object, so nothing React-specific is required to produce one).

#### 5.9 `useRightsDiff()` — dev only

```ts
export interface RightsDiff {
  missing: readonly Scope[]; // declared but not granted → every call fails
  unused: readonly Scope[]; // granted but not declared → least-privilege review
}
export declare function useRightsDiff(): RightsDiff;
```

`missing` is the same set `ScopeContractError` throws on server-side. `unused` is the
least-privilege review nobody does, delivered free. Tree-shaken in production builds via
`process.env.NODE_ENV` guards.

---

### 6. Gating components

#### 6.1 `<Can>`

```tsx
export interface CanProps {
  /** A single scope. */
  I?: Scope;
  /** Any-of. Use for screen/nav gating — see §5.4 and apps/org/lib/gate.tsx:35-45. */
  anyOf?: readonly Scope[];
  /** All-of. */
  allOf?: readonly Scope[];
  /** The resource for camp-tier scopes. */
  on?: ResourceRef;

  /**
   * "render"   (default) — children when granted, `fallback` otherwise.
   * "annotate" — clone the SINGLE child element, injecting disabled state,
   *              aria-describedby, title and data-afrikaburn-state.
   */
  mode?: "render" | "annotate";

  /**
   * NARROWING ONLY. May turn a server "explain" into "notFound".
   * May NEVER turn a server "notFound" into an "explain" — that sentence
   * confirms a free camp exists. A widening request is ignored and warns in dev.
   */
  degrade?: "explain" | "notFound";

  fallback?: React.ReactNode;
  /** Shown while status === "pending". Size it like the real control. */
  skeleton?: React.ReactNode;

  children: React.ReactNode;
}

export declare function Can(props: CanProps): React.JSX.Element | null;
```

Render matrix:

| verdict             | `mode="render"`                                                                  | `mode="annotate"`                                                                                     |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `granted`           | `children`                                                                       | `children`, untouched                                                                                 |
| `hollow`            | `fallback ?? null` + dev warning naming `mode="annotate"` — **never `children`** | child cloned with `disabled`, `title={clause}`, `aria-describedby`, `data-afrikaburn-state="hollow"`  |
| `denied` `explain`  | `fallback ?? null`                                                               | child cloned with `disabled`, `title={message}`, `aria-describedby`, `data-afrikaburn-state="denied"` |
| `denied` `notFound` | `null`                                                                           | `null` — **the child is not rendered at all**                                                         |
| `pending`           | `skeleton ?? null`                                                               | `skeleton ?? null`                                                                                    |
| `unavailable`       | `fallback ?? null` — **fail closed**                                             | `null`                                                                                                |

**Why `hollow` does not render `children` in `"render"` mode.** A hollow grant is one the
server _will_ refuse — the department owns no domain, so `orgCanInDomain` returns false
everywhere. `mode="render"` cannot inject `disabled`, so rendering `children` there would
produce an enabled control the server refuses: the "console refuses what it renders" failure
`packages/core/src/org-permissions.ts:20-25` exists to delete, and it would fail the
"hollow renders disabled" test in §12.5. A `data-*` attribute on a wrapper is styling, not
disabling. So `"render"` mode falls back and warns; `"annotate"` is the mode that produces
the behaviour §5.3's table describes.

Two things this component does **not** do:

- **It ships no styles.** The decision describes hollow grants rendering "disabled + amber".
  Amber is `--warning` (`#F4B672`, build-spec §7 "Tankwa Night"), which is a _Quagga Portal_
  token — a published package cannot depend on `@quagga/ui` or assume Tailwind. `<Can>`
  emits `data-afrikaburn-state="granted" | "hollow" | "denied"` and the integrator's
  stylesheet decides. An optional `@afrikaburn/react/styles.css` ships a tokenless default.
  _(spec author's call.)_
- **It does not hide the reason.** A `denied`/`explain` control stays in the DOM, disabled,
  carrying the server's own sentence. `packages/core/src/org-domains.ts`'
  `departmentDomainsNote` exists specifically so nobody "find[s] out by being refused in
  front of a colleague"; a silently vanished button teaches less than a refused one. The
  exception is `notFound`, where the existence itself is the secret.

**Rejected:** `inert()` Proxy namespaces that make `ab.suppliers` itself unusable
(decision 19). A Proxy breaks destructuring, `Object.keys` and debugger expansion, and
needs a third hand-maintained policy table mapping namespaces to root scopes. Methods
throw; namespaces exist.

#### 6.2 `<Refusal>`

```tsx
export interface RefusalProps {
  scope: Scope;
  on?: ResourceRef;
  /** Render nothing when the scope is granted (default true). */
  quietWhenGranted?: boolean;
  className?: string;
  children?: (refusal: RefusalRecord) => React.ReactNode;
}
export declare function Refusal(props: RefusalProps): React.JSX.Element | null;
```

Renders the server's sentence and, when present, `remediationUrl` as a link. Renders
`null` for `mode: "notFound"` — unconditionally, with no prop to override it.

**Naming, and it is a compiler constraint rather than taste.** The record type is
`Refusal` in `@afrikaburn/sdk` (§7.2 uses it as `NotAuthorisedError.refusal`). Inside
`@afrikaburn/react` the component of the same name cannot coexist with an import of the
type — `import type { Refusal } from "@afrikaburn/sdk"` next to `function Refusal()` is
TS2440, _Import declaration conflicts with local declaration_, because an import binds the
name in every namespace. So the react package imports it aliased
(`import type { Refusal as RefusalRecord }`) and must **not** re-export the type from its
own barrel. Consumers get the component from `@afrikaburn/react` and the type from
`@afrikaburn/sdk`; §5.5's `useRefusal` returns `RefusalRecord | null` under the same
aliasing.

#### 6.3 `<RightsInspector>`

```tsx
export interface RightsInspectorProps {
  /** Default "bottom-right". */
  position?: "bottom-left" | "bottom-right";
  /** Default "ctrl+shift+k". */
  hotkey?: string | false;
}
export declare function RightsInspector(
  props?: RightsInspectorProps,
): React.JSX.Element | null;
```

Renders the whole manifest: subject rank **label** (`system_manager | org_staff | engineer`
— `"god"` never crosses the boundary; `ORG_RANK_LABELS.god` is "System manager",
`packages/core/src/org-permissions.ts:154`), org grants with their `hollow` flags, the camp
allowlist with backstop flags, the lazy refusal list, `routes`, `limits`, and the
declared-vs-granted diff. This is the answer to "what can my key do", and per the prior-art
survey no vendor in the eight-vendor sample ships it: Cloudflare's
`/user/tokens/verify` returns liveness only, and GitHub fine-grained PATs have no
introspection at all. _(Vendor claims here and in §7.2 — Cloudflare error 9109's overloading
— are inherited from the prior-art shard and were not re-verified against vendor docs in
this pass.)_

Returns `null` when `process.env.NODE_ENV === "production"`, so it cannot be shipped by
accident.

---

### 7. Loading, error and unauthorised states

#### 7.1 The three failures are different and must not share a UI

| Failure                     | Where it originates                                      | Component                                | Recovery                                      |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| **Not authorised**          | manifest says no, or server returns `insufficient_scope` | `<Can>` / `NotAuthorisedError`           | operator changes the key's scopes             |
| **Not found / not visible** | server returns 404, or 200-with-empty for a camp probe   | `notFound` mode; `useCampGrant` → `null` | none — and the UI must not imply there is one |
| **Not available**           | manifest fetch failed, delegation expired, network down  | `unavailable`; `AfrikaBurnError`         | retry; gates stay closed meanwhile            |

#### 7.2 Error taxonomy as seen from React

```ts
export class AfrikaBurnError extends Error {
  readonly type: string; // RFC 9457 `type` URI
  readonly code: string; // stable machine code, one per cause
  readonly status?: number;
  readonly requestId?: string;
  readonly docsUrl?: string;
}

export class NotAuthorisedError extends AfrikaBurnError {
  readonly code: "insufficient_scope" | "insufficient_rights";
  readonly requiredScopes: readonly Scope[];
  readonly refusal?: Refusal; // the server's sentence, when it authored one
  readonly remediationUrl?: string;
}
export class ScopeContractError extends AfrikaBurnError {
  readonly missing: readonly Scope[];
  readonly held: readonly Scope[];
}
export class ManifestDriftError extends AfrikaBurnError {
  readonly expected: string;
  readonly actual: string;
}
export class NoCredentialError extends AfrikaBurnError {}
export class MissingProviderError extends AfrikaBurnError {}
```

`insufficient_scope` (the key's ceiling) and `insufficient_rights` (the live subject's
resolution) are **separate codes** because they send you to two different people to ask.
One code per cause: Cloudflare's error 9109 overloads permission-denied, IP restriction and
auth-failure lockout onto one identifier, and it is the single worst thing in the vendor
survey.

`ManifestDriftError` is loud on purpose. The false _positive_ — manifest allows, server
refuses — self-corrects, because the request happened and the error fires. The false
_negative_ is invisible: the SDK refused locally, the request never happened, no telemetry
exists, and the integrator concludes the platform is broken. Which is why:

- there is a documented per-call escape, `preflight: false`, at the top of the README;
- the manifest TTL is **300s**, matched deliberately to
  `AUTH_SESSION.cookieCacheMaxAgeSeconds` (`packages/auth/src/env.ts:56-60`), so there is
  one staleness story to explain rather than two;
- the README states, in its own words, that **the manifest eliminates key-scope errors, not
  authorisation errors.** Roughly five of the twelve deny-by-construction rules are
  preflightable; the rest — free-camp visibility, questionnaire result-scope crossing,
  officer consent, `isEditableStatus`, the escalation clause, the audience sub-algebra —
  are relationship-level and still arrive over the wire.

#### 7.3 Error boundaries

```tsx
export interface AfrikaBurnErrorBoundaryProps {
  fallback: (error: AfrikaBurnError, reset: () => void) => React.ReactNode;
  /** Re-throw anything that is not an AfrikaBurnError (default true). */
  passthrough?: boolean;
  children: React.ReactNode;
}
```

`passthrough: true` by default so the integrator's own boundary still sees their own bugs.
Swallowing every error is how an SDK becomes the thing people blame for unrelated crashes.

#### 7.4 Loading

Route-level loading uses the App Router's own `loading.tsx`. The repo's rule applies and is
worth quoting because it is right: a boundary "only stops the navigation feeling broken if
it shows the DESTINATION's shape… when the real content lands the layout jumps, which reads
as a second load" (`packages/ui/src/components/skeleton.tsx` header). `<Can skeleton>`
takes the same discipline: size the skeleton like the control it stands in for.

---

### 8. Next.js App Router specifics

#### 8.1 Where the key may live, exhaustively

| Location                                   | API key                    | Delegation token |
| ------------------------------------------ | -------------------------- | ---------------- |
| `app/**/page.tsx` (RSC, no `"use client"`) | ✅                         | ✅               |
| `app/**/route.ts`                          | ✅                         | ✅               |
| `"use server"` action file                 | ✅                         | ✅               |
| `middleware.ts`                            | ✅ (edge — WebCrypto only) | ✅               |
| any file with `"use client"`               | ❌                         | ✅               |
| a prop passed to a client component        | ❌ **never**               | ✅               |
| `NEXT_PUBLIC_*` env var                    | ❌ **never**               | n/a              |

**Why the prop row is absolute.** The `report-server` precedent
(`packages/core/src/report-server/index.ts:1-13`) notes that a leaked `process.env.GITHUB_TOKEN`
would be replaced with `undefined` in a client bundle — Next protects env vars. It does
**not** protect a value passed as a prop: an API key handed to a client component is a
literal the bundler inlines and RSC serialises into the flight payload. This is a strictly
worse hazard than the one that motivated the subpath split in `@quagga/core`, and the
mitigations are correspondingly harder.

Enforcement, three mechanisms, because the decision says be stricter than the precedent:

1. **The type system.** `AfrikaBurnProviderProps` has no `apiKey` field. `BrowserClient`
   has no constructor taking one. The isomorphic entry's `ClientConfig` type does not
   contain the string `apiKey` anywhere.
2. **`import "server-only"`** at the top of `@afrikaburn/sdk/server` and
   `@afrikaburn/react/server`. Build fails if a client component pulls either in.
3. **eslint `no-restricted-imports`** in `packages/sdk-react` banning `@afrikaburn/sdk/server`,
   `@quagga/db`, `@quagga/auth`, `better-auth`, `drizzle-orm`, `@neondatabase/serverless`,
   `next/server` and `server-only` from the `"use client"` entry. This rides
   `pnpm turbo run lint`, which already exists — `.github/workflows/ci.yml:102` runs
   `pnpm turbo run lint typecheck test build`. `@quagga/auth` is banned by
   name for a second reason: it cannot emit declarations at all (TS2883 — the comment is in
   `packages/auth/tsconfig.json`).

React's `experimental_taintUniqueValue` is defence-in-depth at most: it is explicitly not
production-ready, and cloning or reconstructing a tainted value defeats it. It is not the
boundary. The absence of an `apiKey` field is.

#### 8.2 Server actions

Server actions are public HTTP endpoints. An action that wraps an SDK write must re-check —
the SDK's own server call re-checks on the AfrikaBurn side, but the _integrator's_ action
also needs to know that the caller is who they claim to be, which is the integrator's
session concern, not ours. State it in the README; do not try to solve it.

```ts
// app/camps/[slug]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@afrikaburn/sdk/server";
import { NotAuthorisedError } from "@afrikaburn/sdk/errors";

const ab = createServerClient({
  apiKey: process.env.AFRIKABURN_API_KEY!,
  scopes: ["camp:assign_roles", "camp:view_member_details"] as const,
});

export type SetRolesResult =
  | { ok: true }
  | { ok: false; message: string; remediationUrl?: string };

export async function setMemberRoles(
  slug: string,
  membershipId: string,
  roleIds: string[],
): Promise<SetRolesResult> {
  // …the integrator's OWN session check belongs here…
  try {
    await ab.groups.roles.assign({ slug, membershipId, roleIds });
    revalidatePath(`/camps/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof NotAuthorisedError) {
      return {
        ok: false,
        message: e.refusal?.message ?? "This key is not authorised for that.",
        remediationUrl: e.remediationUrl,
      };
    }
    throw e;
  }
}
```

Returning the refusal rather than throwing follows the repo's own `assertCapability`
contract: "never fake an unsupported capability. A surface for an `unavailable` capability
must render an honest 'not available yet' state and its action must fail closed — never a
silent no-op that looks like success" (`packages/core/src/auth-capabilities.ts:20-23` — the
file header, not the function). The shape it returns —
`CapabilityGuardResult = { ok: true } | { ok: false; message: string; support }`, declared
at `:250-251` and produced by `assertCapability` at `:257-269` — is the template.

#### 8.3 Streaming and Suspense

`<RightsHydrator>` is async and will suspend. Put it **above** the content it gates, not
beside it, so the gate resolves before the controls stream in. A page that streams a
roster and then, 200ms later, disables half the buttons is the "console refuses what it
renders" failure with better latency numbers.

#### 8.4 Route segment config

The manifest is per-key and TTL'd; a page that renders it must not be statically cached
across keys. `export const dynamic = "force-dynamic"` on any segment under a
`RightsHydrator` — the repo does exactly this on its own permission-dependent pages
(`apps/web/app/(app)/camps/[slug]/settings/roles/page.tsx:29`). Public read-only pages using
`public:*` scopes only may stay static.

---

### 9. SSR and hydration of the manifest

#### 9.1 The contract

- The manifest is fetched **once per request**, server-side, by `<RightsHydrator>`.
- It crosses as a plain prop. No custom serialiser.
- `useCan()` is **synchronous on first render**, server and client. There is no
  denied→granted flash, because there is no moment at which the client does not know.
- The client re-validates nothing on mount. Hydration mismatch is impossible for gates
  because both sides read the same document.

#### 9.2 Validation on the client side

The React package cannot zod-parse the manifest: the zod output schemas that _are_ the PII
stripper live in `@quagga/types/responses` (private, FSL — decision 10), and adding a zod
runtime dependency to a published React package for one shape assertion is the wrong trade.
The client performs a cheap structural assertion instead:

```ts
function assertManifest(m: unknown): asserts m is Manifest {
  if (!m || typeof m !== "object")
    throw new AfrikaBurnError("Manifest missing.");
  if ((m as Manifest).manifestVersion !== 1) {
    throw new AfrikaBurnError(
      `Unsupported manifest version. Upgrade @afrikaburn/react.`,
    );
  }
}
```

Fail closed on failure: no manifest → every `useCan` returns `unavailable` → every `<Can>`
renders its fallback. _(spec author's call. The alternative — a zod peer — costs every
consumer a runtime dependency for an assertion the server already made.)_

#### 9.3 Mid-session revocation

**Two different "versions", and they must not be confused.** `manifestVersion` (§9.2) is the
_document schema_ version — it says whether this build of the package can read the JSON at
all, and it is what `assertManifest` checks. `manifest.kernel` is the _rights_ version — it
changes when what the key may do changes. `X-AfrikaBurn-Manifest-Version` carries the
**kernel**, not the schema version; the header name is inherited from decision §3.6 and is
worth renaming there to `X-AfrikaBurn-Rights-Version` before anything ships.

The header rides on **every** response, success included (decision
§3.6). The transport compares it to `manifest.kernel`; on mismatch it marks the manifest
query stale and calls `refresh()`. The provider re-renders with the new document and the
button flips. Round trips to flip a revoked permission in a rendered UI: **one**, and it is
the request the user was already making.

`X-AfrikaBurn-Accepted-Scopes` also rides on every response. The SDK accumulates a live
scope→endpoint map from ordinary traffic — the trick GitHub's classic-PAT
`X-Accepted-OAuth-Scopes` header enables and that nobody else in the survey copies. It
feeds `<RightsInspector>` and nothing else; it is never used to make a gating decision,
because a header is not a grant.

#### 9.4 Prefetch and dehydrate

For data (not the manifest), the standard TanStack SSR path applies:

```tsx
// app/camps/[slug]/page.tsx
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { ab } from "./client"; // the module-scoped createServerClient of §4.4

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const qc = new QueryClient();
  await qc.prefetchQuery(ab.groups.roster.queryOptions({ slug }));
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <Roster slug={slug} />
    </HydrationBoundary>
  );
}
```

The query-option factories are produced by the **core** client, not the React one — they
are plain objects, which is the whole reason `queryOptions()` is a typed identity function.
That keeps `@afrikaburn/sdk` framework-agnostic and lets a Vue or Svelte wrapper consume
the same factories unchanged.

---

### 10. Cache semantics

#### 10.1 Query keys

```
["afrikaburn", keyId, "manifest"]
["afrikaburn", keyId, namespace, method, argsHash]
```

`keyId` is `manifest.key.id`. It is in the key **so two credentials never share a cache
entry** — an integrator running a multi-tenant server with per-tenant delegation tokens
must not serve tenant A's roster to tenant B out of a shared `QueryClient`. This is the
cache-level restatement of the same isolation the DB-level design gets from resolving the
live subject per request.

`manifest.kernel` is deliberately **not** in the data query keys. Putting it there would
invalidate every cached read on every server deploy, which is a self-inflicted thundering
herd for no security benefit — a kernel bump changes what you may do, not what the data
says.

#### 10.2 Staleness

| Query                    | `staleTime`                               | `gcTime` | Refetch on window focus |
| ------------------------ | ----------------------------------------- | -------- | ----------------------- |
| manifest                 | `expiresAt - now` (server-authored, 300s) | 10 min   | yes                     |
| `public:*` reads         | 5 min                                     | 30 min   | no                      |
| `camp:*` / `org:*` reads | 30 s                                      | 5 min    | yes                     |
| `self:*` reads           | 0                                         | 5 min    | yes                     |

Manifest `staleTime` is derived from the server's own `expiresAt`, not a constant we pick.
The server owns the TTL; the client obeys it. If the server shortens the TTL during an
incident, every client follows within one cycle with no release.

#### 10.3 Invalidation rules

| Trigger                          | Invalidates                                                |
| -------------------------------- | ---------------------------------------------------------- |
| version-header mismatch          | `["afrikaburn", keyId, "manifest"]` only                   |
| `NotAuthorisedError` on any call | the manifest (the local view was wrong) + the failed query |
| successful mutation              | the namespaces named in the mutation's `invalidates` array |
| delegation refresh               | manifest (the new grant carries a new one); data survives  |

There is no public `refresh()`. Decision §3.5 cut it alongside `mode: "disabled"` for the
same reason: three overlapping staleness hatches is two too many, and the one that gets
used in production is always the one that hides the bug.

---

### 11. Optimistic updates

#### 11.1 The rule

**Never optimistically apply a write the manifest denies.** If `useCan` says `denied`, the
control was disabled and the mutation never fires. If `useCan` says `granted`, apply
optimistically — and be ready for the server to disagree, because the manifest preflights
key-scope errors, not authorisation errors (§7.2). The rollback path is not an edge case;
it is the _expected_ path for every relationship-level rule the manifest cannot see:
`isEditableStatus` (`apps/web/lib/registration-store.ts:33`), the escalation clause
(`roleGrantsElevatedPrivileges`, `packages/core/src/project-permissions.ts:142`, re-checked
at `apps/web/lib/roles-store.ts:432-447`), officer consent, and the questionnaire audience
sub-algebra.

#### 11.2 With TanStack

```tsx
const assign = useAfrikaBurnMutation({
  scopes: ["camp:assign_roles"],
  mutationFn: (v: { membershipId: string; roleIds: string[] }) =>
    ab.groups.roles.assign({ slug, ...v }),

  onMutate: async (v) => {
    await qc.cancelQueries({ queryKey: rosterKey });
    const previous = qc.getQueryData<RosterData>(rosterKey);
    qc.setQueryData<RosterData>(
      rosterKey,
      (r) =>
        r && {
          ...r,
          members: r.members.map((m) =>
            m.membershipId === v.membershipId
              ? { ...m, roleIds: v.roleIds }
              : m,
          ),
        },
    );
    return { previous }; // this object is TContext — see §5.8
  },

  onError: (error, _v, ctx) => {
    qc.setQueryData(rosterKey, ctx?.previous); // roll back, always
    if (error instanceof NotAuthorisedError) {
      // The SERVER's sentence, verbatim. Never invent one.
      toast.error(error.refusal?.message ?? error.message);
      qc.invalidateQueries({ queryKey: ["afrikaburn", keyId, "manifest"] });
    }
  },

  onSettled: () => qc.invalidateQueries({ queryKey: rosterKey }),
});
```

Two non-negotiables in that block:

- **`onError` rolls back before it inspects the error.** An optimistic row that survives a
  403 is a UI that reports success it did not achieve.
- **The message is the server's.** `orgCapabilityRefusal` already produces three different
  truthful sentences for a scoped refusal (`packages/core/src/org-permissions.ts:589-603`)
  and names who can fix it. An SDK-invented "Permission denied" throws that away.

#### 11.3 With server actions and `useOptimistic`

**Stated precisely, because the repo does less than this section originally claimed.** The
repo's precedent is server actions + `useTransition` + `router.refresh()` — no optimistic
layer at all (`apps/org/components/decision-panel.tsx:73-80` and `:90`,
`apps/org/components/org-roles/roles-manager.tsx:184`). `useOptimistic` appears **nowhere**
in this monorepo (zero hits across `apps/` and `packages/`). So the block below is a
_recommendation_ for integrators, not a pattern the repo already runs. Both paths are
supported; the optimistic layer is the consumer's, not the SDK's:

```tsx
const [optimistic, applyOptimistic] = React.useOptimistic(members, reduceRoles);
const [pending, startTransition] = React.useTransition();

function onAssign(membershipId: string, roleIds: string[]) {
  startTransition(async () => {
    applyOptimistic({ membershipId, roleIds });
    const res = await setMemberRoles(slug, membershipId, roleIds); // §8.2
    if (!res.ok) toast.error(res.message); // React reverts on transition end
  });
}
```

`useOptimistic` reverts automatically once the transition settles and the component
re-renders against the real state, so the rollback is structural rather than remembered.
That is the better default for a consumer app. It is _not_ what the repo does today — the
repo takes the simpler route of `useTransition` + `router.refresh()` with no optimistic
state to roll back — and this shard is recommending it rather than citing it.

---

### 12. Testing

#### 12.1 Environment

Match the repo's existing React test setup: Vitest + jsdom + `@testing-library/react` +
`@vitejs/plugin-react`, per `packages/ui/vitest.config.ts`. Copy the timeouts too —
`testTimeout: 30_000` — for the measured reason recorded in that file: on a two-core CI
runner, `turbo run test` across eight workspaces makes a five-second default fail at
random, "and a gate that fails at random is a gate people learn to re-run rather than read".

#### 12.2 Manifest fixtures

```ts
import { buildManifest, grant, camp, refuse } from "@afrikaburn/react/testing";

const manifest = buildManifest({
  key: { id: "key_test" }, // required: §10.1 keys every cache entry on manifest.key.id,
  // so buildManifest must default it rather than omit it
  subject: { kind: "service", id: "svc_1", rank: "org_staff" },
  org: [
    grant("read", {
      departments: [{ id: "d1", name: "Theme camps" }],
      domains: ["registrations"],
    }),
    grant("update", {
      departments: [{ id: "d2", name: "Suppliers" }],
      domains: [],
    }), // hollow
  ],
  camps: [
    camp("dusty-arms", {
      permissions: ["camp:view_member_details"],
      backstop: false,
    }),
    camp("the-ashram", { backstop: true }), // lead/admin — expands to nothing, flags everything
  ],
  refusals: [
    refuse("camp:assign_roles", {
      reason: "not_granted",
      mode: "explain",
      message: "This key is not authorised to assign roles in that camp.",
    }),
    refuse(
      "camp:view_member_details",
      { reason: "not_visible", mode: "notFound" },
      { on: { slug: "some-free-camp" } },
    ),
  ],
});
```

The `notFound` fixture is deliberately a **camp** scope. The org console's own posture is
the opposite — "transparency with restrictions rather than a console that hides its own
existence from colleagues" (`apps/org/lib/gate.tsx:36-38`), and "DISABLED, NOT HIDDEN"
(`apps/org/components/decision-panel.tsx:65-68`). Free-camp existence
(`apps/web/lib/groups-store.ts:187`) is the case the repo actually hides, so it is the case
`mode: "notFound"` exists for. An org domain resolving to `notFound` would need its own
justification and this shard does not offer one.

`grant(...)` with `domains: []` produces a `hollow` grant — the exact case
`summarizeOrgActor` distinguishes and the exact case a naive implementation flattens.
Every consumer test suite should have one.

#### 12.3 Mock client

```tsx
import {
  createMockClient,
  MockAfrikaBurnProvider,
} from "@afrikaburn/react/testing";

const ab = createMockClient({
  manifest,
  handlers: {
    "groups.roster": async ({ slug }) => rosterFixture(slug),
    "groups.roles.assign": async () => {
      throw new NotAuthorisedError(/* … */);
    },
  },
});

render(
  <MockAfrikaBurnProvider client={ab}>
    <RosterPage slug="dusty-arms" />
  </MockAfrikaBurnProvider>,
);
```

`createMockClient` **runs the same `assertScopes` gate as the real client** against the
supplied manifest. A test that passes with a mock and fails in production because the mock
was permissive is worse than no test.

#### 12.4 MSW

For integration-level tests that exercise the transport (headers, drift, 404-vs-403):

```ts
import { setupServer } from "msw/node";
import { afrikaburnHandlers } from "@afrikaburn/sdk/testing";

const server = setupServer(
  ...afrikaburnHandlers({
    manifest,
    routes: manifest.routes,
    fixtures: { "GET /api/v1/groups/:slug/roster": rosterFixture },
  }),
);
```

`afrikaburnHandlers` emits `X-AfrikaBurn-Accepted-Scopes` and
`X-AfrikaBurn-Manifest-Version` on every response, exactly as the server does, so
drift-handling is testable without a live backend. `msw` is an **optional peer** of the
`/testing` subpath only.

#### 12.5 The tests every consumer should have — and every one we ship

| Test                       | Asserts                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| hollow renders disabled    | a `domains: []` grant does not render an enabled control                                                                       |
| `notFound` renders nothing | `<Can degrade="explain">` on a `notFound` verdict still renders nothing                                                        |
| `degrade` cannot widen     | requesting `explain` over a server `notFound` warns and is ignored                                                             |
| no flash                   | first client render matches server render; zero denied→granted transitions                                                     |
| fail closed                | manifest fetch failure → every gate closed, no unguarded control                                                               |
| revocation                 | changing the version header flips a button within one request                                                                  |
| delegation cannot widen    | a token minted with a superset of its key's scopes is rejected                                                                 |
| no key in the bundle       | build the demo app with a known sentinel key; grep every client chunk for the sentinel **value** and for the `qg_live_` prefix |

The last one is a build artefact assertion, not a unit test, and it belongs in CI. Grep for
the _value_, never the `apiKey` identifier — a minifier renames identifiers, so an
identifier grep is a test that passes for the wrong reason.

---

### 13. Worked example — a camp roster page, twice

The scenario: an integrator builds a crew-management tool. It shows a camp's roster and
lets an authorised user change a member's roles. The real backing surfaces are
`apps/web/lib/roles-store.ts:869 getMemberPermissions` (permission resolution),
`:400 setMemberRoles` (the write) and `apps/web/app/(app)/camps/[slug]/actions.ts:211
setMemberRolesAction` (the guard funnel).

#### 13.1 Naive — every mistake in one file

```tsx
"use client";
import { useEffect, useState } from "react";
import { AfrikaBurn } from "@afrikaburn/sdk";

// MISTAKE 1: the API key is in a client component. Next inlines it into the bundle.
const ab = new AfrikaBurn({ apiKey: process.env.NEXT_PUBLIC_AB_KEY! });

export function Roster({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // MISTAKE 2: fetch on mount. Empty first paint, no SSR, waterfall.
  useEffect(() => {
    ab.groups.roster({ slug }).then(setMembers);
  }, [slug]);

  if (!members) return <p>Loading…</p>;

  return (
    <ul>
      {members.map((m) => (
        <li key={m.membershipId}>
          {m.displayName}
          {/* MISTAKE 3: always rendered enabled. The user discovers the refusal
              by being refused — in front of a colleague. */}
          <button
            onClick={async () => {
              try {
                await ab.groups.roles.assign({
                  slug,
                  membershipId: m.membershipId,
                  roleIds: [],
                });
              } catch (e) {
                // MISTAKE 4: an invented message. The server wrote a better one
                // and named who can fix it; this throws that away.
                setError("Something went wrong");
              }
            }}
          >
            Edit roles
          </button>
        </li>
      ))}
      {/* MISTAKE 5: no distinction between "you may not" and "this does not exist".
          On a free camp, this page confirms the camp exists — which the platform
          spends four call sites preventing. */}
      {error && <p>{error}</p>}
    </ul>
  );
}
```

Five defects, each of which the permission-aware version closes structurally rather than by
remembering:

| #   | Defect                 | Consequence                                                                                                 |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | key in a client bundle | credential theft; every visitor holds the integration's rights                                              |
| 2   | fetch on mount         | no SSR, waterfall, empty first paint                                                                        |
| 3   | control always enabled | "the console refuses what it renders" — the exact failure `org-permissions.ts:20-25` was refactored to kill |
| 4   | invented error copy    | discards `orgCapabilityRefusal`'s three truthful sentences and its "who can fix it" clause                  |
| 5   | no `notFound` path     | a free camp's existence is confirmed to a stranger, violating the law at `groups-store.ts:187`              |

#### 13.2 Permission-aware

**`app/camps/[slug]/page.tsx` — RSC. Holds the key, mints the token, prefetches.**

```tsx
import { notFound } from "next/navigation";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { createServerClient } from "@afrikaburn/sdk/server";
import { RightsHydrator } from "@afrikaburn/react/server";
import { refreshDelegation } from "./actions";
import { Roster } from "./roster";

export const dynamic = "force-dynamic";

const ab = createServerClient({
  apiKey: process.env.AFRIKABURN_API_KEY!,
  scopes: ["camp:view_member_details", "camp:assign_roles"] as const,
});

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 200-with-empty for all three not-visible cases: no such camp, a free camp
  // you cannot see, a camp this key holds nothing in. Identical bytes, identical
  // latency budget. We cannot tell them apart, and that is correct.
  const grant = await ab.groups.capabilities({ slug });
  if (!grant) notFound();

  const qc = new QueryClient();
  await qc.prefetchQuery(ab.groups.roster.queryOptions({ slug }));

  return (
    <RightsHydrator
      client={ab}
      delegate={["camp:view_member_details", "camp:assign_roles"]}
      groupIds={[grant.groupId]}
      refresh={refreshDelegation}
    >
      <HydrationBoundary state={dehydrate(qc)}>
        <Roster slug={slug} />
      </HydrationBoundary>
    </RightsHydrator>
  );
}
```

**`app/camps/[slug]/roster.tsx` — client. No key, no fetch-on-mount, no flash.**

```tsx
"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAfrikaBurn,
  useCan,
  useCampGrant,
  useAfrikaBurnMutation,
  Can,
  Refusal,
} from "@afrikaburn/react";
import type { CampRoster as RosterData } from "@afrikaburn/sdk";
import { NotAuthorisedError } from "@afrikaburn/sdk/errors";
import { toast } from "sonner"; // the integrator's own toaster
import { RosterSkeleton } from "./roster-skeleton"; // the integrator's own skeleton

export function Roster({ slug }: { slug: string }) {
  const ab = useAfrikaBurn();
  const qc = useQueryClient();

  // Synchronous on FIRST render — server and client agree, no flash.
  const canRead = useCan("camp:view_member_details", { slug });
  const canAssign = useCan("camp:assign_roles", { slug });
  const { backstop } = useCampGrant({ slug });

  const rosterKey = ab.groups.roster.queryOptions({ slug }).queryKey;
  const roster = useQuery({
    ...ab.groups.roster.queryOptions({ slug }),
    enabled: canRead.ok,
  });

  const assign = useAfrikaBurnMutation({
    scopes: ["camp:assign_roles"],
    mutationFn: (v: { membershipId: string; roleIds: string[] }) =>
      ab.groups.roles.assign({ slug, ...v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: rosterKey });
      // NOT `<Roster>` — `Roster` is this component. A function declaration creates no
      // type, so `getQueryData<Roster>` is TS2749. The payload type is aliased above.
      const previous = qc.getQueryData<RosterData>(rosterKey);
      qc.setQueryData<RosterData>(
        rosterKey,
        (r) =>
          r && {
            ...r,
            members: r.members.map((m) =>
              m.membershipId === v.membershipId
                ? { ...m, roleIds: v.roleIds }
                : m,
            ),
          },
      );
      return { previous };
    },
    onError: (error, _v, ctx) => {
      qc.setQueryData(rosterKey, ctx?.previous);
      if (error instanceof NotAuthorisedError) {
        // The server's own sentence. It names the reason AND who can fix it.
        toast.error(error.refusal?.message ?? error.message);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: rosterKey }),
  });

  // Reading the roster is itself gated. `notFound` renders nothing at all —
  // no "you may not see this", because that sentence confirms the camp exists.
  if (!canRead.ok) {
    if (canRead.status === "denied" && canRead.mode === "explain") {
      return <p role="status">{canRead.message}</p>;
    }
    return null;
  }

  if (roster.isPending) return <RosterSkeleton rows={6} />;
  if (roster.isError) return <p role="alert">{roster.error.message}</p>;

  return (
    <>
      {backstop && (
        <p className="notice">
          This key acts as a camp lead here. Lead access is structural and
          cannot be narrowed by scopes.
        </p>
      )}

      <ul>
        {roster.data.members.map((m) => (
          <li key={m.membershipId}>
            <span>{m.displayName}</span>

            {/* annotate mode: the button stays in the DOM, disabled, carrying the
                server's sentence in `title` and `aria-describedby`. A hollow grant
                gets data-afrikaburn-state="hollow" and the grant-scope clause.
                A `notFound` verdict renders nothing — degrade cannot widen it. */}
            <Can I="camp:assign_roles" on={{ slug }} mode="annotate">
              <button
                onClick={() =>
                  assign.mutate({ membershipId: m.membershipId, roleIds: [] })
                }
                disabled={assign.isPending}
              >
                Edit roles
              </button>
            </Can>
          </li>
        ))}
      </ul>

      {/* The refusal, once, near the control it explains — not a toast that
          vanishes before it is read. Renders null when granted or notFound. */}
      <Refusal scope="camp:assign_roles" on={{ slug }} />
    </>
  );
}
```

**What changed, and why each is structural rather than remembered:**

| Naive                                 | Permission-aware                                              | Made impossible by                                                    |
| ------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| key in the bundle                     | key in the RSC; token in the browser                          | `AfrikaBurnProviderProps` has no `apiKey`; `server-only`; eslint      |
| fetch on mount                        | RSC prefetch + `HydrationBoundary`                            | `queryOptions` factories on the core client                           |
| button always enabled                 | `<Can mode="annotate">`                                       | `useCan` returns six states, not a boolean                            |
| invented copy                         | `error.refusal.message`                                       | the message is generated once, server-side, by `orgCapabilityRefusal` |
| leaks existence                       | `notFound` renders nothing; camp probe returns 200-with-empty | `mode` is server-authored; `degrade` may only narrow                  |
| hollow indistinguishable from granted | `status: "hollow"` + clause                                   | `OrgGrant.hollow` survives from `summarizeOrgActor`                   |
| lead rendered as five toggles         | `backstop` notice                                             | `CampGrant.backstop` is a flag, never scopes                          |

---

### 14. What this package will not add

| Refused                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `<Show>`-style component that also handles auth state         | Sessions are the integrator's problem. We gate a key's rights, not a user's login.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Client-side PII stripping                                       | Decision 10: the zod output schema's `.parse()` **is** the stripper, server-side. A client-side filter is the per-caller filter §9.4 decision 2 forbids, and it would teach integrators that stripping happens on their side. Hard-locked fields (`packages/core/src/privacy.ts:39-47`) are absent from the response _type_, with no error branch and no remediation link — because a scope for phone numbers, even one that always denies, is the affordance that eventually gets a `true`. |
| A `useMedicalNotes` hook                                        | `SAFETY_VISIBLE_FIELDS = ["medical"]` (`privacy.ts:57`). The consented audience is "your camp leads and AfrikaBurn's safety/org staff" (`privacy.ts:12-21`). An integrator is neither, and exposing it would make the integrator's own log the compliance record for `bio.medical.view`.                                                                                                                                                                                                     |
| A bespoke cache                                                 | Decision 24. Manifest TTL + version-invalidation + SSR hydration is TanStack Query; writing it is writing it badly.                                                                                                                                                                                                                                                                                                                                                                          |
| `inert()` Proxy namespaces                                      | Decision 19. Breaks destructuring, `Object.keys`, debugger expansion; needs a third policy table.                                                                                                                                                                                                                                                                                                                                                                                            |
| Exposing `"god"`                                                | `ORG_RANK_LABELS.god` is "System manager" (`packages/core/src/org-permissions.ts:154`), a deliberate divergence documented in three places including `packages/types/src/roles.ts:20-42`. A public SDK **is** a label layer. `Manifest.subject.rank` is `"system_manager" \| "org_staff" \| "engineer" \| null`.                                                                                                                                                                             |
| `ab.collectives`, `ab.wranglers`, `ab.participants`, `ab.users` | Parked feature; npm collision with Cloudflare's `wrangler`; engineering prose not user-facing copy; and the schema has both `users` (`packages/db/src/schema.ts:283`) and `user` (`:358`), which makes `User` a fatal type name.                                                                                                                                                                                                                                                             |
