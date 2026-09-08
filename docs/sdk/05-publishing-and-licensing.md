## Publishing, licensing and repo mechanics

This shard is the contract for getting `@afrikaburn/sdk` and `@afrikaburn/react` out of this
monorepo and onto npm without carrying FSL-licensed code, an API key, or a server-only
dependency across the boundary. It specifies the directory layout, the build, the exports maps,
how the new workspaces join the gate that already exists, the licence boundary and the four CI
mechanisms that enforce it, npm ownership, changesets, the release workflows, provenance,
deprecation, the docs site, and how a contributor runs the SDK against a local stack.

Everything here is grounded in files read in this session. Where a claim about a third-party
tool could not be verified in this session (`node_modules/` does not exist in this checkout —
`ls node_modules` returns nothing), it is marked **UNVERIFIED** with the pre-flight that must
close it before first publish.

---

### 1. Directory layout

```
packages/
  scopes/          @quagga/scopes      PRIVATE — never published. The vocabulary's authoring home.
                                       src/** files are Apache-2.0 AT BIRTH (§5.2).
  sdk/             @afrikaburn/sdk     PUBLIC — Apache-2.0.
  sdk-react/       @afrikaburn/react   PUBLIC — Apache-2.0.
```

Three new workspaces under `packages/*`, which `pnpm-workspace.yaml` already globs (`apps/*`,
`packages/*`, `e2e` — four lines, verified). No change to `pnpm-workspace.yaml` is required.

**Why they sit in `packages/` and not a sibling repo.** The vocabulary is derived from
`packages/types/src/roles.ts` and the manifest producer lives in `packages/core`; a second
repository means a version axis between the scope strings and the predicates that resolve them,
which is the failure `packages/core/src/org-permissions.ts:23-25` deleted the old
`RANK_CAPABILITIES` table to avoid. In-repo, the drift gate in §5.5 makes a mismatch a red
build. Out-of-repo, it is a support ticket.

**Why `packages/scopes` exists at all rather than the SDK reading `@quagga/types`.**
`packages/types/src/roles.ts:150` is `export const ORG_CAPABILITY_KEYS = OrgCapabilityKey.options;`
— the runtime tuple is derived _from_ a zod enum, and `roles.ts:1` is `import { z } from "zod"`.
An SDK that reached that tuple would drag zod into a package whose whole selling point is zero
runtime dependencies. `packages/scopes` holds zod-free `as const` tuples; `roles.ts` inverts to
`z.enum(ORG_CAPABILITY_KEYS)` (~10 lines, §5 item 2 of the decision).

**THREE tuples move, not one, and moving fewer breaks a product law.** The vocabulary is spread
across two packages today, verified:

| tuple                         | lives at today                                                                          | inversion required                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORG_CAPABILITY_KEYS` (5)     | `packages/types/src/roles.ts:150`, from `OrgCapabilityKey` at `:141-147`                | `z.enum(ORG_CAPABILITY_KEYS)`                                                                                                                                     |
| `PROJECT_PERMISSION_KEYS` (5) | `packages/types/src/roles.ts:271`, from `ProjectPermissionKey` at `:262-268`            | `z.enum(CAMP_PERMISSIONS)`                                                                                                                                        |
| `ORG_DOMAINS` (8)             | **`packages/core/src/org-domains.ts:72`** — core, not types; a plain `as const`, no zod | `export const ORG_DOMAINS = SCOPE_ORG_DOMAINS;` (same shape as `org-permissions.ts:212`, which is already `export const ORG_CAPABILITIES = ORG_CAPABILITY_KEYS;`) |

All three must re-export from `@quagga/scopes`. If `packages/scopes` declares its own copy of any
of them, the repo has a second source of truth for permissions — the exact failure
`packages/core/src/org-permissions.ts:23-25` deleted `RANK_CAPABILITIES` to avoid, and a product
law, not a preference. The drift gate in §5.5 only proves _sdk vs scopes_; it cannot see a
divergence between `scopes` and a duplicate left behind in `core` or `types`, so the inversion is
the mechanism and there is no second one.

`5 × 8 = 40` org scopes + 5 camp permissions = 45, and `SELF_SCOPES` + `PUBLIC_SCOPES` (new in
this design; no counterpart exists in the repo today) make up the remaining 4 of the 49.

**Why `packages/sdk-react` on disk but `@afrikaburn/react` on npm.** The directory keeps the
`sdk-` prefix so `ls packages/` groups the published pair together and nobody mistakes it for the
private `packages/ui`. The package name drops it because `@afrikaburn/sdk-react` reads worse at
an import site than `@afrikaburn/react`. Commit scope is `react` (§4).

**Internal layout of `packages/sdk`:**

```
packages/sdk/
  LICENSE                       Apache-2.0, full text
  NOTICE                        Apache-2.0 §4(d)
  README.md                     ships in the tarball; the only prose an integrator reads first
  package.json
  tsconfig.json                 extends @quagga/typescript-config/node.json  (NOT base.json — §2)
  tsdown.config.ts
  eslint.config.js              adds the no-restricted-imports wall (§5.4)
  vitest.config.ts              coverage floors; joins the ci.yml matrix (§4.3)
  src/
    index.ts                    ISOMORPHIC entry. No apiKey option exists in its types.
    server.ts                   the ONLY entry that accepts an API key
    server.browser.ts           4 lines; throws. Wired via the "browser" export condition (§3.2)
    manifest.ts                 types + the pure evaluator. Serialisable, RSC-safe.
    errors.ts                   the taxonomy
    generated/
      vocabulary.ts             EMITTED from packages/scopes. Committed. Drift-gated (§5.5).
      namespaces.ts             EMITTED method stubs + @requires/@see JSDoc
    __tests__/                  vitest, mock fetch, no stack
    __integration__/            vitest, real local stack, opt-in (§11.2)
```

`packages/sdk-react` mirrors it minus `server.ts`, plus `src/components/` carrying `"use client"`.

---

### 2. Build tooling

**tsdown** (rolldown/oxc), extending `packages/typescript-config/node.json`.

`node.json` is verified to have the right shape — `module: NodeNext`, `moduleResolution: NodeNext`,
`noEmit: false`, `outDir: dist` — and is currently referenced by **no** package: every workspace
tsconfig extends `base.json` or `react-library.json`. `base.json` sets
`"moduleResolution": "Bundler"`, which is correct for the three apps' `transpilePackages` arrays
and wrong for a published package — it permits extensionless relative specifiers that emit ESM
Node cannot resolve. The SDK is the first consumer of `node.json`.

Rejected: `tsc` alone — cannot emit dual ESM/CJS, and adopting `composite: true` across
`packages/*` forces `declaration: true` on `@quagga/auth`, which its own tsconfig disables to
dodge TS2883 (`packages/auth/tsconfig.json`, comment verified). Rejected: `tsup` — esbuild drops
top-of-file directives during bundling, and `"use client"` preservation is load-bearing for
`@afrikaburn/react`; it also couples the SDK's compiler to the root `pnpm.overrides`
`esbuild: ">=0.28.1"` (`package.json:33-37`).

**UNVERIFIED:** tsdown's directive preservation, `unbundle` mode and oxc `.d.ts` emission are
asserted from knowledge, not from docs read in this session. Pre-flight before the first publish:
build `packages/sdk-react`, then `grep -c '"use client"' packages/sdk-react/dist/**/*.js` and
confirm it equals the source count. If it does not, fall back to `tsup` with a `banner` injecting
the directive; nothing else in this shard changes.

```ts
// packages/sdk/tsdown.config.ts
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsdown";

export default defineConfig({
  // FOUR ENTRIES, NOT ONE BARREL. `./server` is the only one that may hold an
  // API key, and the separation is the report-server precedent applied
  // (packages/core/src/report-server/index.ts:1-13): a subpath plus the
  // discipline that the barrel never re-exports it. `server.browser.ts` is the
  // third mechanism — see the "browser" condition in package.json.
  entry: [
    "src/index.ts",
    "src/server.ts",
    "src/server.browser.ts",
    "src/manifest.ts",
    "src/errors.ts",
  ],

  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022", // matches packages/typescript-config/base.json
  tsconfig: "./tsconfig.json",
  clean: true,

  // UNBUNDLE. One output module per source module rather than one chunk per
  // entry. Two reasons, both measurable: a bundler downstream can drop a
  // namespace nobody imports (the generated namespace stubs are ~40 of them),
  // and module-level directives survive because there is no chunk to hoist
  // them out of.
  unbundle: true,

  // ZERO RUNTIME DEPENDENCIES IS THE PRODUCT. `external` is empty because
  // `dependencies` is empty. If this list ever needs an entry, that is a
  // design change, not a build tweak — see §5.3, which fails the build when a
  // published package names a workspace dependency.
  external: [],

  // "neutral" so nothing pulls a node builtin shim into the isomorphic entry.
  // The `./server` entry's node usage (if any) is gated by the export
  // condition, not by the platform target.
  platform: "neutral",
});
```

```ts
// packages/sdk-react/tsdown.config.ts
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  tsconfig: "./tsconfig.json",
  clean: true,
  unbundle: true,
  platform: "neutral",
  // PEERS AND THE CORE STAY EXTERNAL. Bundling @afrikaburn/sdk in here would
  // give a consumer two copies of the manifest evaluator and two Scope unions,
  // which is exactly the version-skew failure decision 25 exists to prevent.
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@afrikaburn/sdk",
    "@tanstack/react-query",
  ],
});
```

```jsonc
// packages/sdk/tsconfig.json
{
  // node.json, NOT base.json. base.json sets moduleResolution "Bundler", which
  // is right for the apps' transpilePackages and wrong for anything that emits
  // JavaScript a stranger's Node has to resolve.
  "extends": "@quagga/typescript-config/node.json",
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/__tests__/**", "src/**/__integration__/**"],
  "compilerOptions": {
    "outDir": "dist",
    // No "types": ["node"]. The isomorphic entry must not see node globals, or
    // somebody will reach for process.env and the eslint wall will be the only
    // thing that notices.
    "types": [],
  },
}
```

---

### 3. package.json, written out

#### 3.1 `packages/scopes/package.json`

```json
{
  "name": "@quagga/scopes",
  "version": "0.0.0",
  "private": true,
  "license": "Apache-2.0",
  "type": "module",
  "sideEffects": false,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "codegen:sdk": "tsx scripts/emit-sdk-vocabulary.mts",
    "docs:emit": "tsx scripts/emit-scope-docs.mts"
  },
  "devDependencies": {
    "@quagga/eslint-config": "workspace:*",
    "@quagga/typescript-config": "workspace:*",
    "@vitest/coverage-v8": "^4.1.10",
    "eslint": "^10.4.0",
    "tsx": "^4.23.5",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  }
}
```

Consumed as source, like every other workspace (`main`/`types` → `./src/index.ts`). No `build`
script: it has no emit, and adding one would put it in the apps' build path for nothing.
`"license": "Apache-2.0"` on a `"private": true` package is not a contradiction — see §5.2.

#### 3.2 `packages/sdk/package.json`

```json
{
  "name": "@afrikaburn/sdk",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "description": "TypeScript client for the AfrikaBurn platform. The API key's rights define which methods are usable.",
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "LICENSE", "NOTICE", "README.md"],
  "engines": { "node": ">=20" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/RyRy79261/afrikaburn-contributors-app.git",
    "directory": "packages/sdk"
  },
  "homepage": "https://github.com/RyRy79261/afrikaburn-contributors-app/tree/main/packages/sdk#readme",
  "bugs": "https://github.com/RyRy79261/afrikaburn-contributors-app/issues",
  "keywords": ["afrikaburn", "burn", "theme-camp", "sdk", "api-client"],
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./server": {
      "browser": {
        "types": "./dist/server.browser.d.ts",
        "import": "./dist/server.browser.js",
        "require": "./dist/server.browser.cjs"
      },
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js",
      "require": "./dist/server.cjs"
    },
    "./manifest": {
      "types": "./dist/manifest.d.ts",
      "import": "./dist/manifest.js",
      "require": "./dist/manifest.cjs"
    },
    "./errors": {
      "types": "./dist/errors.d.ts",
      "import": "./dist/errors.js",
      "require": "./dist/errors.cjs"
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {},
  "devDependencies": {
    "@arethetypeswrong/cli": "^0.18.2",
    "@quagga/eslint-config": "workspace:*",
    "@quagga/typescript-config": "workspace:*",
    "@vitest/coverage-v8": "^4.1.10",
    "eslint": "^10.4.0",
    "publint": "^0.3.16",
    "tsdown": "^0.16.5",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  },
  "scripts": {
    "build": "tsdown",
    "lint": "eslint .",
    "lint:pack": "publint && attw --pack .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

**`publint` and `attw` are a SEPARATE script, not part of `lint`.** Both read `dist/`, and
`turbo.json:52-55` is `"lint": { "dependsOn": ["^build"], "outputs": [] }` — a package's own
`build` is **not** a dependency of its own `lint`, only its _dependencies'_ builds are. Folding
them into `lint` makes `pnpm turbo run lint typecheck test build` fail on a cold clone, because
turbo is free to schedule `lint` before `tsdown` has written anything. See §4.1: this is the one
place `turbo.json` does need an edit.

Four things in that file are load-bearing and must not be softened:

| field                                    | why                                                                                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"files"` allowlist                      | not `.npmignore`. A denylist fails open: the first server-shaped file somebody adds ships by default. The repo has no `.npmignore` anywhere today (verified) — do not introduce one.                                       |
| `"types"` FIRST in every condition block | TypeScript resolves conditions in order; `types` after `import` is silently ignored under `moduleResolution: NodeNext`. `attw --pack` in `lint` is what proves it.                                                         |
| `"browser"` condition on `./server`      | `dist/server.browser.js` is four lines that throw at import naming the correct entry. A bundler that resolves `@afrikaburn/sdk/server` in a browser graph gets a build-time-visible failure instead of an inlined API key. |
| `"dependencies": {}`                     | the tarball check in §5.6 asserts it stays empty. Zero runtime deps is what makes the artifact auditable.                                                                                                                  |

```ts
// packages/sdk/src/server.browser.ts
// SPDX-License-Identifier: Apache-2.0
//
// THE THIRD MECHANISM. The `exports` map routes `@afrikaburn/sdk/server` here
// under the "browser" condition, and the eslint wall (§5.4) bans importing
// `./server` from the isomorphic entry. AGENTS.md rule 7 (`:135-137`) says
// "UI hiding is never the security boundary"; the same reasoning says a README
// paragraph is not one either — so this throws.
//
// Next replaces `process.env.GITHUB_TOKEN` with `undefined` in a client bundle
// (packages/core/src/report-server/index.ts:1-13 says so). An INTEGRATOR'S API
// KEY IS NOT ENV — it is a literal the bundler inlines. That is the whole
// difference, and why the precedent needs a third mechanism this one didn't.
throw new Error(
  "@afrikaburn/sdk/server was imported into a browser bundle. It holds an API key and " +
    "must only run on a server. Use @afrikaburn/sdk (token or fetch-callback) in the browser, " +
    "or @afrikaburn/react with a server-fetched manifest.",
);
export {};
```

#### 3.3 `packages/sdk-react/package.json`

```json
{
  "name": "@afrikaburn/react",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "description": "React bindings for @afrikaburn/sdk — useCan, <Can>, <RightsHydrator>, <RightsInspector>.",
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "LICENSE", "NOTICE", "README.md"],
  "engines": { "node": ">=20" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/RyRy79261/afrikaburn-contributors-app.git",
    "directory": "packages/sdk-react"
  },
  "publishConfig": { "access": "public", "provenance": true },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@afrikaburn/sdk": "workspace:*"
  },
  "peerDependencies": {
    "@tanstack/react-query": "^5",
    "react": "^19"
  },
  "peerDependenciesMeta": {
    "@tanstack/react-query": { "optional": true }
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "^0.18.2",
    "@quagga/eslint-config": "workspace:*",
    "@quagga/typescript-config": "workspace:*",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.15",
    "@vitejs/plugin-react": "^6.0.2",
    "@vitest/coverage-v8": "^4.1.10",
    "eslint": "^10.4.0",
    "jsdom": "^29.1.1",
    "publint": "^0.3.16",
    "react": "^19.2.6",
    "tsdown": "^0.16.5",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  },
  "scripts": {
    "build": "tsdown",
    "lint": "eslint .",
    "lint:pack": "publint && attw --pack .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

`"@afrikaburn/sdk": "workspace:*"` — pnpm rewrites `workspace:*` to the **exact** version at
publish (`workspace:^` would give a caret). Exact is required: decision 25 says rights are one
type in one version, and `@afrikaburn/react@1.4.0` resolving `@afrikaburn/sdk@^1.4.0` to `1.9.0`
means a `Scope` union from one version gating a manifest shape from another. Changesets `fixed`
(§7) keeps the two version numbers identical so this is never surprising.

`react` is a peer at `^19` — the repo pins `^19.2.6` (`packages/ui/package.json`). `react-dom` is
deliberately **not** a peer: the SDK's components render no DOM-specific API and an RSC consumer
has no `react-dom` in the server graph.

`@tanstack/react-query` is an **optional** peer (decision 24). Root `.npmrc` sets
`strict-peer-dependencies=false` (verified, 3 lines), so a wrong peer range is invisible in this
repo — `publint` and `attw --pack` are what catch it, via the `lint:pack` task added to
`turbo.json` in §4.1 (it needs `dist`, so it cannot ride the existing `lint`).

---

### 4. Joining the existing turbo gate

The gate is `pnpm turbo run lint typecheck test build` (`.github/workflows/ci.yml:102`,
`AGENTS.md` "THE gate"). It is workspace-wide, so it picks up three new workspaces with no edit —
but `turbo.json` needs **one** new task (§4.1) and the gate command grows one word.

#### 4.1 turbo.json: one new task, plus one thing that changes on its own

`turbo.json:44` already lists `dist/**` as a build output. `turbo.json:24` is
`"dependsOn": ["^build"]`, `turbo.json:57` is `"typecheck": { "dependsOn": ["^build", "build"] }`.

**What must be added.** `turbo.json:52-55` is `"lint": { "dependsOn": ["^build"], "outputs": [] }`
— `^build` is _dependencies'_ builds, never the package's own. `publint` and `attw --pack` read
`dist/`, so they cannot live in `lint`; they get their own task, and it is the only turbo.json
change this shard requires:

```jsonc
    "lint:pack": {
      // READS dist/. Unlike `lint`, this one needs THIS package's own build,
      // which is why it is a separate task rather than two more commands in the
      // `lint` script — turbo would otherwise be free to schedule it first.
      "dependsOn": ["build"],
      "outputs": []
    },
```

and `ci.yml:102` becomes `pnpm turbo run lint typecheck test build lint:pack`. Only the two
published packages define a `lint:pack` script, so it is a no-op everywhere else.

Verified: `grep -l '"build"' apps/*/package.json packages/*/package.json e2e/package.json` returns
**only the three apps**. So `^build` is a no-op across every package edge in the repo today.
The SDK is the first `packages/*` workspace with a `build` script, and the day it lands:

| edge                                                                  | effect                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@afrikaburn/react` → `@afrikaburn/sdk`                               | `sdk` builds before `react` lints, typechecks or builds. Correct and wanted: `react` consumes the emitted `.d.ts`. |
| `@quagga/types` → `@quagga/scopes`, `@quagga/core` → `@quagga/scopes` | no build on `scopes`, so nothing changes.                                                                          |
| the three apps                                                        | unchanged — no app depends on a published package.                                                                 |

Nothing in the repo gains a build-order dependency it did not already want. State it in the PR
body: this is the commit where `dependsOn: ["^build"]` stops being decoration.

#### 4.2 commitlint — the hard blocker

`commitlint.config.mjs:16-31` is a 10-entry `SCOPES` allowlist; `scope-enum` is severity 2
(`:36`); `ci.yml:36-76` lints the PR title **and every commit in the range**, and `.husky/commit-msg`
lints locally. **Nothing merges until this lands.**

```diff
--- a/commitlint.config.mjs
+++ b/commitlint.config.mjs
@@
   "auth",
   "types",
+  // The published SDK pair and its vocabulary source. NOTE: `sdk` and `react`
+  // are @afrikaburn/*, not @quagga/*, so the rule below is now "the workspace
+  // name with its scope dropped" rather than "with @quagga/ dropped". The
+  // directory is packages/sdk-react; the scope is `react`, matching the
+  // PACKAGE name, because that is what a reader recognises in a changelog.
+  "scopes",
+  "sdk",
+  "react",
   // the e2e workspace
   "e2e",
```

`CONTRIBUTING.md:158-165` documents the same vocabulary in prose and says to keep it in step —
edit both in one commit.

#### 4.3 ci.yml — the mandatory edits

**(a) Coverage matrix rows.** `ci.yml:383-411` is an explicit `include:` list, so a new workspace
is **not** auto-enrolled and its floors would never run.

```yaml
- workspace: "@quagga/scopes"
  label: "@quagga/scopes (vocabulary)"
  directory: packages/scopes
- workspace: "@afrikaburn/sdk"
  label: "@afrikaburn/sdk"
  directory: packages/sdk
- workspace: "@afrikaburn/react"
  label: "@afrikaburn/react"
  directory: packages/sdk-react
```

`@quagga/scopes` gets floors of **100/100/100/100**, following the reasoning already written into
`packages/core/vitest.config.ts` for `privacy.ts` and `medical-access.ts`: it is data with no
branches, so full coverage is trivially achievable, and a floor at the ceiling turns "somebody
put a predicate in the vocabulary package" into a red build on the commit that does it. That is
the whole job of that workspace's floor — it is not measuring test quality, it is a tripwire.

**(b) The licence boundary, tarball and drift checks**, added as three steps to the existing `ci` job so
they inherit its position in `ci-pass`'s `needs` list (`ci.yml:521`) without editing the aggregator:

```yaml
- name: CI gate
  run: pnpm turbo run lint typecheck test build lint:pack

# THE LICENCE BOUNDARY. Two checks, on purpose (§5.3/§5.6): the first
# reads manifests and sources, the second reads the actual tarball. A
# bundler can inline through a devDependency that the first check permits,
# so only the second sees what would really be published.
- name: Licence boundary — manifests and sources
  run: node scripts/licence-boundary.mjs

- name: Licence boundary — the tarball itself
  run: node scripts/licence-tarball.mjs

# The generated vocabulary is committed. If it no longer matches
# packages/scopes, the SDK is shipping a stale Scope union — which is the
# one failure this whole design exists to make impossible.
- name: Vocabulary drift
  run: |
    pnpm --filter @quagga/scopes codegen:sdk
    git diff --exit-code packages/sdk/src/generated
```

`ci.yml:99` and every other install step run `pnpm install --no-frozen-lockfile` with a comment
saying to switch once the lockfile is committed. `pnpm-lock.yaml` **is** committed (270,399 bytes,
verified). The publish workflow uses `--frozen-lockfile` (§8); switching `ci.yml` is a separate,
welcome change and not a blocker for this work.

---

### 5. Licensing

**The decision, not re-argued:** published SDK packages are Apache-2.0; everything else stays
FSL-1.1-ALv2. Root `LICENSE` is FSL-1.1-ALv2 (verified, "Copyright 2026 Ryan Noble and the Quagga
Portal contributors"), root `package.json:4` is `"license": "FSL-1.1-ALv2"`.

#### 5.1 Files that change

**New:**

| path                           | content                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/sdk/LICENSE`         | full Apache-2.0 text. npm reads the per-package `LICENSE`; the root FSL file is not in the tarball. |
| `packages/sdk/NOTICE`          | Apache-2.0 §4(d), text below.                                                                       |
| `packages/sdk-react/LICENSE`   | identical Apache-2.0 text.                                                                          |
| `packages/sdk-react/NOTICE`    | identical to the SDK's.                                                                             |
| `.changeset/config.json`       | §7                                                                                                  |
| `scripts/licence-boundary.mjs` | §5.3                                                                                                |
| `scripts/licence-tarball.mjs`  | §5.6                                                                                                |

```
# packages/sdk/NOTICE

AfrikaBurn Platform SDK
Copyright 2026 Ryan Noble and the Quagga Portal contributors

This product is licensed under the Apache License, Version 2.0.

The Quagga Portal server, apps and domain packages from which this SDK's
vocabulary is derived are licensed separately under the Functional Source
License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2). No FSL-licensed
code is included in this distribution. See
https://github.com/RyRy79261/afrikaburn-contributors-app/blob/main/LICENSE
```

**Modified:**

| path                                               | line(s)                            | change                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                        | 10                                 | the badge reads `Licence: FSL-1.1-ALv2` and links `LICENSE`. Add a second badge for the published packages.                                                                                                                                                                                                                              |
| `README.md`                                        | 218-224                            | "**FSL-1.1-ALv2** … Contributions come in under the same terms" becomes false the day an Apache package lands. Split into repo/server = FSL, `packages/sdk` + `packages/sdk-react` = Apache-2.0, and keep "no CLA to sign".                                                                                                              |
| `AGENTS.md`                                        | 34-35                              | "public repo, **FSL-1.1-ALv2**" — same repo-wide assertion, same correction.                                                                                                                                                                                                                                                             |
| `AGENTS.md`                                        | 37-44 (the packages line is `:41`) | the layout block lists `packages/ @quagga/{auth,ui,db,core,types,eslint-config,typescript-config}`. Add the three new workspaces and mark which are published.                                                                                                                                                                           |
| `.github/CODEOWNERS`                               | after `/LICENSE`                   | add `/packages/sdk/ @RyRy79261`, `/packages/sdk-react/ @RyRy79261`, `/packages/scopes/ @RyRy79261`. CODEOWNERS already owns `/LICENSE` and `/packages/core/` on exactly this reasoning — "places where a mistake is expensive or hard to undo". An Apache grant is irrevocable per version; there is no more expensive undo in the repo. |
| `docs/build-spec.md`                               | 20                                 | hard constraint 2 is "Package namespace `@quagga/`". Amend: `@quagga/` for private workspaces, `@afrikaburn/` for published ones, never both for one thing.                                                                                                                                                                              |
| `commitlint.config.mjs`, `CONTRIBUTING.md:158-165` | §4.2                               |

**SPDX headers.** The repo has none today (grepped, zero hits). This introduces the convention:

| tree                                                                                      | header                                              |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/sdk/**/*.ts`, `packages/sdk-react/**/*.{ts,tsx}`, `packages/scopes/src/**/*.ts` | `// SPDX-License-Identifier: Apache-2.0`            |
| `packages/core/src/**/*.ts`, `packages/types/src/**/*.ts`                                 | `// SPDX-License-Identifier: FSL-1.1-ALv2`          |
| everything else                                                                           | nothing. A header everywhere is noise nobody reads. |

Core and types get FSL headers **because they are the nearest FSL code to the boundary**. Once
code is being lifted between two differently-licensed trees, a per-file marker is the only thing
that survives a copy-paste — and it is what `scripts/licence-tarball.mjs` greps for (§5.6).
`.gitattributes` needs no change: `export-ignore` only affects `git archive`, which this repo does
not use, and the `files` allowlist is the real control.

#### 5.2 The boundary mechanism: generate, never import

The SDK needs the 49 scope strings and the five `as const` vocabularies the generator below emits
(`ORG_CAPABILITIES`, `ORG_DOMAINS`, `CAMP_PERMISSIONS`, `SELF_SCOPES`, `PUBLIC_SCOPES`). It must not import them
from an FSL package, and a published package cannot depend on a private workspace at all —
`pnpm publish` rewrites `workspace:*` to a version npm cannot resolve.

**The mechanism has two halves, and both are required.**

**(a) The vocabulary is Apache-2.0 at birth.** `packages/scopes/src/**` are _new_ files, created
for this work. They carry `// SPDX-License-Identifier: Apache-2.0` from their first commit, and
`packages/scopes/package.json` declares `"license": "Apache-2.0"` alongside `"private": true`.
Nothing is relicensed, because nothing existed. `"private"` and `"license"` answer different
questions: `private` says "npm must refuse to publish this"; `license` says "these are the terms
on the source". The workspace is unpublished (decision 23) _and_ its source is copyable into an
Apache artifact.

Direction of the dependency edge is what makes this safe: `@quagga/types` → `@quagga/scopes` and
`@quagga/core` → `@quagga/scopes` (both needed — see the three-tuple table in §1) are FSL
consuming Apache, which is always legal. The reverse would be the problem, and §5.3 forbids
it mechanically.

Rejected: authoring the vocabulary inside `packages/sdk` and having `@quagga/scopes` re-export it.
That inverts the graph — `@quagga/types` would then depend on a _built_ package, so every app's
typecheck would wait on a bundler, and `transpilePackages` would pull the SDK's `dist` into three
browser bundles. The graph direction is worth more than saving a codegen step.

**(b) The SDK vendors it by codegen, with zero dependency edge.** `packages/sdk` names
`@quagga/scopes` in **no** dependency field — not even `devDependencies`. The generator lives in
`packages/scopes` and writes into the SDK:

```ts
// packages/scopes/scripts/emit-sdk-vocabulary.mts
// SPDX-License-Identifier: FSL-1.1-ALv2
//
// THE GENERATOR IS FSL AND NEVER SHIPS. Its OUTPUT is Apache-2.0 because its
// INPUT is: packages/scopes/src/** are Apache-2.0 at birth (§5.2a). This is a
// copy with a header, not a relicensing.
//
// It runs from packages/scopes, not packages/sdk, so that packages/sdk names
// no workspace package at all and scripts/licence-boundary.mjs can assert that
// absolutely rather than maintaining an exception list.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ORG_CAPABILITIES,
  ORG_DOMAINS,
  PROJECT_PERMISSION_KEYS,
  SELF_SCOPES,
  PUBLIC_SCOPES,
} from "../src/index.ts";

const out = fileURLToPath(
  new URL("../../sdk/src/generated/vocabulary.ts", import.meta.url),
);

const lit = (xs: readonly string[]) =>
  xs.map((x) => JSON.stringify(x)).join(",\n  ");

writeFileSync(
  out,
  `// SPDX-License-Identifier: Apache-2.0
//
// GENERATED — DO NOT EDIT.
// Source: packages/scopes/src/**  ·  Generator: packages/scopes/scripts/emit-sdk-vocabulary.mts
// Regenerate: pnpm --filter @quagga/scopes codegen:sdk
// CI fails if this file and its source disagree (.github/workflows/ci.yml, "Vocabulary drift").

export const ORG_CAPABILITIES = [
  ${lit(ORG_CAPABILITIES)}
] as const;

export const ORG_DOMAINS = [
  ${lit(ORG_DOMAINS)}
] as const;

export const CAMP_PERMISSIONS = [
  ${lit(PROJECT_PERMISSION_KEYS)}
] as const;

export const SELF_SCOPES = [
  ${lit(SELF_SCOPES)}
] as const;

export const PUBLIC_SCOPES = [
  ${lit(PUBLIC_SCOPES)}
] as const;
`,
  "utf8",
);
```

The emitted file is **committed**. Consequences, all of them wanted: `pnpm turbo run build` needs
no codegen step; a reviewer sees the 49 strings change in the diff; and the drift gate
(§4.3) is a two-line CI step rather than a build-order problem.

Explicitly rejected: extracting the 1,845-LOC predicate kernel (`org-permissions.ts`,
`org-domains.ts`, `project-permissions.ts`, `privacy.ts`, `medical-access.ts`,
`types/roles.ts`) into a permissive `packages/policy`. That is decision 2 of the architecture, and
it holds for a mechanical reason as well as a licence one: `packages/core/vitest.config.ts` pins
per-file coverage floors to those exact filenames (100/100/100/100 for `privacy.ts` and
`medical-access.ts`; 96/92/95/86 for `org-permissions.ts`; 95/96/100/95 for
`project-permissions.ts`), and `ci.yml`'s coverage matrix enrols them by workspace directory.
Moving the files moves them out from under the job that enforces their floors.

#### 5.3 CI enforcement — the manifest and source gate

```js
// scripts/licence-boundary.mjs
// SPDX-License-Identifier: FSL-1.1-ALv2
//
// A FUTURE IMPORT MUST NOT BE ABLE TO SILENTLY BREACH THE BOUNDARY.
//
// The rule is one sentence: NOTHING FSL MAY REACH AN APACHE ARTIFACT. Three
// ways that breaks, and this file closes all three at the manifest/source
// level. The fourth — a bundler inlining through a path this file permits — is
// closed by scripts/licence-tarball.mjs, which reads the tarball instead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// MIRRORS pnpm-workspace.yaml EXACTLY — `apps/*`, `packages/*`, and `e2e`,
// which is a WORKSPACE, not a directory of workspaces. Treating `e2e` as a
// group (readdirSync over its contents, looking for package.json one level
// down) silently drops `@quagga/e2e` from `workspaceNames`, and a published
// package that depended on a workspace this script cannot see would sail
// through check 2.
const WORKSPACE_GLOB_DIRS = ["packages", "apps"];
const WORKSPACE_LEAF_DIRS = ["e2e"];

// The ONLY workspace packages a published package may name, and only as
// devDependencies. Both are build configuration with no domain content, and a
// consumer of a published package never installs its devDependencies.
// Everything else is a hard failure.
const PERMITTED_DEV_WORKSPACE_DEPS = new Set([
  "@quagga/eslint-config",
  "@quagga/typescript-config",
]);

const errors = [];
const fail = (m) => errors.push(m);

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e === ".turbo") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|jsx)$/.test(p)) out.push(p);
  }
  return out;
}

const workspaces = [];
for (const group of WORKSPACE_GLOB_DIRS) {
  const base = join(ROOT, group);
  for (const name of readdirSync(base)) {
    const dir = join(base, name);
    if (!statSync(dir).isDirectory()) continue;
    const pkg = readManifest(dir);
    if (pkg) workspaces.push({ dir, pkg });
  }
}
for (const leaf of WORKSPACE_LEAF_DIRS) {
  const dir = join(ROOT, leaf);
  const pkg = readManifest(dir);
  if (pkg) workspaces.push({ dir, pkg });
}
const workspaceNames = new Set(workspaces.map((w) => w.pkg.name));
const published = workspaces.filter((w) => w.pkg.private !== true);

if (published.length === 0)
  fail("No published workspace found — this gate would pass vacuously.");

for (const { dir, pkg } of published) {
  const where = relative(ROOT, dir);

  // 1. THE MANIFEST SAYS APACHE, AND SAYS IT COMPLETELY.
  if (pkg.license !== "Apache-2.0")
    fail(`${where}: license must be "Apache-2.0", got ${pkg.license}`);
  for (const f of ["LICENSE", "NOTICE", "README.md"]) {
    try {
      statSync(join(dir, f));
    } catch {
      fail(
        `${where}: missing ${f} — Apache-2.0 §4 requires LICENSE and NOTICE in the distribution`,
      );
    }
  }
  if (!Array.isArray(pkg.files))
    fail(`${where}: "files" allowlist is required (a denylist fails open)`);
  else
    for (const f of ["LICENSE", "NOTICE"]) {
      if (!pkg.files.includes(f)) fail(`${where}: "files" must include ${f}`);
    }
  if (pkg.publishConfig?.access !== "public")
    fail(`${where}: publishConfig.access must be "public"`);
  if (pkg.publishConfig?.provenance !== true)
    fail(`${where}: publishConfig.provenance must be true`);
  if (!pkg.repository?.directory)
    fail(`${where}: repository.directory is required for provenance`);

  // 2. NO DEPENDENCY EDGE INTO A PRIVATE (FSL) WORKSPACE.
  //
  // `workspace:` in dependencies/peer/optional is fatal regardless of target:
  // pnpm rewrites it to a version at publish, and a version of an unpublished
  // package is a broken install. devDependencies are permitted for exactly two
  // build-config packages, listed above.
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (!workspaceNames.has(name)) continue;
      const target = workspaces.find((w) => w.pkg.name === name);
      if (target.pkg.private === true) {
        fail(
          `${where}: ${field}."${name}" points at the PRIVATE workspace ${relative(ROOT, target.dir)}. ` +
            `A published Apache package may not depend on FSL code. Vendor it by codegen (§5.2).`,
        );
      }
      if (!String(range).startsWith("workspace:")) {
        fail(
          `${where}: ${field}."${name}" must use the workspace: protocol so pnpm pins it exactly.`,
        );
      }
    }
  }
  for (const [name] of Object.entries(pkg.devDependencies ?? {})) {
    if (workspaceNames.has(name) && !PERMITTED_DEV_WORKSPACE_DEPS.has(name)) {
      fail(
        `${where}: devDependencies."${name}" is a workspace package. Only ` +
          `${[...PERMITTED_DEV_WORKSPACE_DEPS].join(", ")} are permitted (§5.3).`,
      );
    }
  }

  // 3. EVERY SOURCE FILE CARRIES THE APACHE SPDX MARKER, AND NONE CARRIES THE
  //    FSL ONE. This is what makes a copy-paste from packages/core visible: the
  //    FSL header comes with it, and this fails.
  for (const file of walk(join(dir, "src"))) {
    const text = readFileSync(file, "utf8");
    const head = text.slice(0, 400);
    if (!head.includes("SPDX-License-Identifier: Apache-2.0")) {
      fail(
        `${relative(ROOT, file)}: missing "// SPDX-License-Identifier: Apache-2.0" header`,
      );
    }
    if (text.includes("FSL-1.1")) {
      fail(
        `${relative(ROOT, file)}: contains an FSL marker inside an Apache-2.0 package`,
      );
    }
  }
}

if (errors.length) {
  console.error(
    "LICENCE BOUNDARY BREACHED:\n" + errors.map((e) => `  · ${e}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  `licence boundary ok — ${published.length} published workspace(s) checked`,
);
```

#### 5.4 CI enforcement — the import wall

Rides `pnpm turbo run lint`, which already exists (`ci.yml:102`).

```js
// packages/sdk/eslint.config.js
// SPDX-License-Identifier: Apache-2.0
import base from "@quagga/eslint-config";

/** Everything FSL, everything server-only, and everything that would make this
 *  package Next-coupled. Named individually rather than by a `@quagga/*` glob
 *  so the failure message says WHICH rule was broken and why. */
const FORBIDDEN = [
  {
    group: ["@quagga/*"],
    message:
      "FSL code. The vocabulary is vendored by codegen — see docs/sdk §5.2.",
  },
  {
    group: ["better-auth", "better-auth/*", "@better-auth/*"],
    message:
      "Server-only, and @quagga/auth cannot even emit declarations (TS2883).",
  },
  {
    group: ["drizzle-orm", "drizzle-orm/*", "@neondatabase/serverless"],
    message: "Database access never crosses the SDK boundary.",
  },
  {
    group: ["next", "next/*"],
    message:
      "The SDK is framework-agnostic. Next belongs in the consumer's app.",
  },
  {
    group: ["server-only"],
    message:
      "Next-specific. The `browser` export condition + server.browser.ts is the mechanism here.",
  },
  {
    group: ["zod"],
    message:
      "Zero runtime dependencies is the product. Response validation happens on the server.",
  },
];

export default [
  ...base,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: FORBIDDEN }],
    },
  },
  {
    // THE ISOMORPHIC ENTRY MAY NOT REACH THE SERVER ENTRY. This is the
    // report-server precedent (packages/core/src/index.ts:151-155 — the barrel
    // never re-exports ./report-server) turned into a rule, because there the
    // discipline was enough and here it is not: an API key is a literal a
    // bundler inlines, not an env var Next replaces with undefined.
    files: [
      "src/index.ts",
      "src/manifest.ts",
      "src/errors.ts",
      "src/generated/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...FORBIDDEN,
            {
              group: ["./server", "./server.js", "**/server", "**/server.js"],
              message: "Only @afrikaburn/sdk/server may hold an API key.",
            },
            {
              group: ["node:*"],
              message: "The isomorphic entry runs in a browser.",
            },
          ],
        },
      ],
    },
  },
];
```

`packages/sdk-react/eslint.config.js` is the same `FORBIDDEN` list verbatim (it contains no
`react` entries to relax — `react` is a peer there and stays importable), plus a ban on
`@afrikaburn/sdk/server`. `export default [...base, …]` is valid because
`packages/eslint-config/index.js` default-exports a flat-config **array** (verified — its last
element is the `ignores` block).

#### 5.5 CI enforcement — the drift gate

`pnpm --filter @quagga/scopes codegen:sdk && git diff --exit-code packages/sdk/src/generated`
(§4.3). A stale generated file is not a cosmetic problem: the SDK would ship a `Scope` union that
disagrees with the server's, and every `Deny<S>` gate would be computed against the wrong
vocabulary.

#### 5.6 CI enforcement — the tarball gate

The one that matters most, because it is the only check that sees what would actually be
published. eslint sees source; this sees emit.

```js
// scripts/licence-tarball.mjs
// SPDX-License-Identifier: FSL-1.1-ALv2
//
// WHY THIS EXISTS SEPARATELY FROM licence-boundary.mjs.
//
// That script reads manifests and sources. A bundler does not: tsdown resolves
// through whatever node_modules offers, and a devDependency, a tsconfig `paths`
// entry or a relative `../core/src/...` import would let FSL bytes into dist
// without any manifest saying so. This unpacks the real artifact and reads what
// is in it.
//
// It runs after `turbo run build` in ci.yml and again in publish.yml. Twice, on
// purpose: the publish leg must not trust that CI ran.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = ["packages/sdk", "packages/sdk-react"];

const errors = [];
for (const rel of PACKAGES) {
  const dir = join(ROOT, rel);
  const work = mkdtempSync(join(tmpdir(), "ab-tarball-"));

  // `pnpm pack` applies the "files" allowlist and rewrites workspace: ranges
  // exactly as publish would. Anything this misses, publish would ship.
  const tgz = execFileSync("pnpm", ["pack", "--pack-destination", work], {
    cwd: dir,
  })
    .toString()
    .trim()
    .split("\n")
    .pop();
  execFileSync("tar", ["-xzf", tgz, "-C", work]);
  const pkgRoot = join(work, "package");

  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      statSync(p).isDirectory() ? walk(p) : files.push(p);
    }
  })(pkgRoot);

  const rels = files.map((f) => relative(pkgRoot, f));
  const say = (m) => errors.push(`${rel}: ${m}`);

  for (const required of ["LICENSE", "NOTICE", "README.md", "package.json"]) {
    if (!rels.includes(required)) say(`tarball is missing ${required}`);
  }

  // NOTHING OUTSIDE dist/ AND THE FOUR METADATA FILES.
  const allowed = new Set(["LICENSE", "NOTICE", "README.md", "package.json"]);
  for (const r of rels) {
    if (!allowed.has(r) && !r.startsWith("dist/"))
      say(`unexpected file in tarball: ${r}`);
  }

  // NO FSL MARKER ANYWHERE IN THE ARTIFACT. This is what the SPDX headers on
  // packages/core/src/** and packages/types/src/** buy: an inlined copy brings
  // its header, and this catches it.
  for (const f of files) {
    if (
      /\.(js|cjs|mjs|ts|map)$/.test(f) &&
      readFileSync(f, "utf8").includes("FSL-1.1")
    ) {
      say(`FSL-licensed content found in ${relative(pkgRoot, f)}`);
    }
  }

  // The published manifest, after pnpm's workspace: rewriting.
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  if (pkg.license !== "Apache-2.0") say(`published license is ${pkg.license}`);
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith("@quagga/"))
      say(`published dependency on a private workspace: ${name}`);
    if (String(range).startsWith("workspace:"))
      say(`unrewritten workspace: range for ${name}`);
  }
  if (
    rel === "packages/sdk" &&
    Object.keys(pkg.dependencies ?? {}).length > 0
  ) {
    say(
      `@afrikaburn/sdk must have ZERO runtime dependencies; found ${Object.keys(pkg.dependencies).join(", ")}`,
    );
  }
}

if (errors.length) {
  console.error(
    "TARBALL CHECK FAILED:\n" + errors.map((e) => `  · ${e}`).join("\n"),
  );
  process.exit(1);
}
console.log("tarball licence check ok");
```

#### 5.7 Why four mechanisms and not one

| #   | mechanism                                         | catches                                               | blind to                                                               |
| --- | ------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `licence-boundary.mjs` — manifests + SPDX headers | a declared dependency; a pasted FSL file              | a bundler resolving through a devDependency or a relative path         |
| 2   | eslint `no-restricted-imports`                    | an FSL import in SDK source                           | a re-export chain through a permitted package; anything outside `src/` |
| 3   | drift gate                                        | a stale vocabulary                                    | a licence problem                                                      |
| 4   | `licence-tarball.mjs` — the artifact              | everything that reached `dist/`, however it got there | a problem that is not textual                                          |

Mechanism 4 is the boundary; 1-3 are the fast, legible failures that stop 4 from ever having to
fire. The repo's own rule generalises: `AGENTS.md:135-137` (rule 7) is "UI hiding is never the
security boundary", and a comment saying "don't import core" is the same category of thing — a
statement of intent, not a mechanism.

---

### 6. npm org ownership and name reservation

**Scope: `@afrikaburn/*`. Fallback: `@quagga-portal/*`. Never `@quagga/*`.**

`@quagga/` is load-bearing as the private workspace scope — 7 packages, all `"private": true`,
all `0.0.0` (verified across every `packages/*/package.json`), and named as hard constraint 2 in
`docs/build-spec.md:20`. Publishing `@quagga/core` would mean either two different things called
`@quagga/core`, or publishing the real one — which depends on `@anthropic-ai/sdk`, exports
`./report-server`, and carries every authz predicate.

**The gate, and it is a governance gate, not an engineering one.** `git remote` is
`https://github.com/RyRy79261/afrikaburn-contributors-app` — a personal account — and `LICENSE:9`
reads "Copyright 2026 Ryan Noble and the Quagga Portal contributors". `@afrikaburn` is a claim on
a real non-profit's name. **No `@afrikaburn/*` package is published until an AfrikaBurn-controlled
npm organisation exists and the publishing identity is a member of it.** npm scope ownership is
not transferable without npm support involvement; getting it wrong is a permanent registry scar.

Reservation procedure, in order, once the org exists:

```bash
# 1. Create the org on npmjs.com under an AfrikaBurn-controlled account.
#    A scope cannot be reserved without an org — there is no other mechanism.

# 2. Claim both names before anything else can. Publish from a clean checkout of
#    main, from the release workflow (§8), not a laptop.
#    `--tag next` so nothing resolves these as `latest` before v0.1 is real.
npm publish --tag next   # @afrikaburn/sdk@0.0.1-alpha.0
npm publish --tag next   # @afrikaburn/react@0.0.1-alpha.0

# 3. Reserve the third name now, empty, so a future CLI is not blocked:
#    @afrikaburn/cli@0.0.1-alpha.0

# 4. Verify ownership landed where intended, not on a personal account:
npm owner ls @afrikaburn/sdk
```

Unpublishing is possible only within 72 hours of publish and only if nothing depends on the
package; treat every publish as permanent.

**Trademark.** FSL-1.1-ALv2's Trademarks clause (`LICENSE:81-85`) grants no trademark rights, and
the SDK is Apache-2.0 whose §6 likewise grants none. Publishing under a name that _is_ the
organisation's mark therefore needs written sign-off from AfrikaBurn, recorded in the PR that
creates the org. If it cannot be obtained, `@quagga-portal/*` — product-named, unclaimed
(`quagga-portal` unscoped returns 404 per the naming survey; **UNVERIFIED in this session**, no
network calls made here) — is the honest fallback and requires no change to anything in this shard
except the strings.

---

### 7. Versioning and changesets

`@changesets/cli`, added as a root `devDependency`.

It fits this repo unusually well: every existing workspace is `"private": true` at `"0.0.0"`
(verified, all 7 packages plus 3 apps plus e2e), so with `privatePackages` turned off changesets
touches only the two published packages and produces no version churn anywhere else.

```jsonc
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "RyRy79261/afrikaburn-contributors-app" },
  ],
  "commit": false,
  "access": "public",
  "baseBranch": "main",

  // FIXED, NOT LINKED. `linked` bumps together only when both changed; `fixed`
  // keeps the version numbers IDENTICAL always. @afrikaburn/react pins
  // @afrikaburn/sdk exactly (workspace:* → the exact version at publish), and
  // decision 25 is that rights are one type in one version: a react@1.4.0
  // resolving sdk@1.9.0 gates a 1.9 manifest against a 1.4 Scope union.
  // Identical numbers make that unrepresentable and make "which versions go
  // together" a non-question for an integrator.
  "fixed": [["@afrikaburn/sdk", "@afrikaburn/react"]],
  "linked": [],

  // The other TWELVE workspaces are private and stay at 0.0.0 forever — the
  // eleven that exist today (7 packages + 3 apps + e2e, all verified
  // "private": true at "0.0.0") plus @quagga/scopes. Without this,
  // `changeset version` rewrites all of them and `changeset tag` creates twelve
  // meaningless tags per release.
  "privatePackages": { "version": false, "tag": false },

  "updateInternalDependencies": "patch",
  "ignore": [],
}
```

Tags come out as `@afrikaburn/sdk@1.2.3`. `changeset tag` creates them; nothing is hand-tagged,
and no workflow runs `git push --follow-tags` against `main` (see §8 on permissions).

**Semver policy.** The SDK's public surface is three things — the `Scope` union, the method
surface each scope gates, and the response DTO types — and each has its own rule:

| change                                                 | bump      | why                                                                                                                                                                                               |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add a scope to the vocabulary                          | **minor** | the union widens; a declared tuple that did not name it is unaffected, and a new gated method appears as `Deny<...>` to existing consumers, which is not a break because they were not calling it |
| remove a scope                                         | **major** | the union narrows, so `createServerClient<["removed:scope"]>` stops compiling                                                                                                                     |
| change the scope a method requires                     | **major** | a consumer's declared tuple silently stops covering a call they already make. This is the change most likely to be shipped as a patch by accident — see the v1.0 gate below                       |
| add a method                                           | minor     |                                                                                                                                                                                                   |
| remove or rename a method                              | major     |                                                                                                                                                                                                   |
| add an optional field to a response DTO                | minor     |                                                                                                                                                                                                   |
| remove a field from a response DTO, or narrow its type | major     |                                                                                                                                                                                                   |
| add a field to a _request_ type as required            | major     |                                                                                                                                                                                                   |
| change `manifest.manifestVersion`                      | major     | the evaluator is the contract                                                                                                                                                                     |
| refusal copy, docs, JSDoc, `remediationUrl`            | patch     |                                                                                                                                                                                                   |

**The v1.0 CI gate for row 3** (decision §6, "a scope change on an existing operation fails CI
unless the changeset is `major`"): the emitted scope→operation registry is committed; a job diffs
it against the last published version's registry (fetched from the tarball on npm), and if any
operation's required scope changed, it asserts a `major` changeset exists in `.changeset/`. Until
that job exists, the rule is a review item on `@RyRy79261` via CODEOWNERS (§5.1).

**Changeset hygiene.** A PR touching `packages/sdk` or `packages/sdk-react` without a changeset is
a release that silently does not happen. Add to the existing `ci` job:

```yaml
# A published package changed with no changeset means the fix never ships.
# `--since` against the base branch, so this only fires on the PRs it means.
- name: Changeset present for published-package changes
  if: github.event_name == 'pull_request'
  run: pnpm exec changeset status --since=origin/${{ github.base_ref }}
```

---

### 8. Release CI

Two new workflow files. **`.github/workflows/ci.yml` keeps `permissions: contents: read`
(`ci.yml:18-19`)** — its comment explains why at length, and adding `id-token: write` there would
raise privilege for the lint, e2e and coverage jobs too. Release privilege lives in files that do
nothing else.

#### 8.1 `.github/workflows/release-pr.yml`

```yaml
name: Release PR

# Opens and refreshes the "version packages" pull request. It writes to a branch
# and to a PR and does nothing else — which is why it is its own file with its
# own permissions rather than a job in ci.yml (ci.yml:12-19 is contents: read,
# deliberately, and must stay that way).
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

# NOT cancel-in-progress. A cancelled changesets run can leave the version
# branch half-written; the next push then opens a PR from a partial state. The
# job is fast and idempotent — let it finish.
concurrency:
  group: release-pr
  cancel-in-progress: false

jobs:
  version:
    name: version packages
    runs-on: ubuntu-latest
    # Forks must never open a release PR on this repository.
    if: github.repository == 'RyRy79261/afrikaburn-contributors-app'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.30.0

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # PINNED TO A COMMIT, NOT A TAG. `@v1` is mutable and this step holds
      # contents: write on main. Same rule the coverage comment step already
      # follows (ci.yml:512).
      - name: Create or update the version PR
        uses: changesets/action@c8bada60c408975afd1a20b3db81d6eee6789308 # v1.4.9
        with:
          # THE TITLE AND COMMIT MUST PASS COMMITLINT. Changesets defaults to
          # "Version Packages", which is not a Conventional Commit and fails
          # `scope-enum` at severity 2 (commitlint.config.mjs:36) — and CI lints
          # the PR TITLE as well as every commit in the range (ci.yml:63-76).
          # The default would make every release PR red on its own gate.
          #
          # 72 characters max (commitlint.config.mjs:40). This is 34.
          title: "chore(repo): version packages"
          commit: "chore(repo): version packages"
          # `pnpm install --lockfile-only` after versioning: workspace versions
          # changed, so pnpm-lock.yaml must change with them or the publish leg's
          # `--frozen-lockfile` install fails on the very commit it is releasing.
          version: pnpm changeset version && pnpm install --lockfile-only
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

#### 8.2 `.github/workflows/publish.yml`

```yaml
name: Publish

# Publishes any package whose version is not yet on the registry. On a push to
# main where nothing was versioned, `changeset publish` exits 0 having published
# nothing — so this is safe to run on every push and needs no path filter that
# could go stale.
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  # THE ONLY PLACE THIS APPEARS IN THE REPOSITORY. npm trusted publishing
  # exchanges this OIDC token for a short-lived registry credential, which is
  # what makes NPM_TOKEN unnecessary — there is no long-lived secret to steal.
  id-token: write

concurrency:
  group: publish
  cancel-in-progress: false

jobs:
  publish:
    name: publish to npm
    runs-on: ubuntu-latest
    if: github.repository == 'RyRy79261/afrikaburn-contributors-app'
    # A GitHub environment with required reviewers. The first few releases go
    # through a human; an irrevocable Apache grant on a version is not something
    # to discover after the fact. Remove the reviewer requirement once the
    # cadence is boring — keep the environment for its deployment log.
    environment: npm-publish
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.30.0

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org

      # --frozen-lockfile HERE, WHATEVER ci.yml DOES.
      #
      # ci.yml:95-99 still installs with --no-frozen-lockfile behind a comment
      # saying to switch once the lockfile is committed. It is committed
      # (pnpm-lock.yaml, 270 KB). Publishing from a non-frozen install means the
      # tree that ships is not provably the tree that was reviewed — a
      # supply-chain hole with a one-word fix, and this is the one leg where it
      # is not negotiable.
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # THE FULL GATE, RE-RUN. This job must not trust that ci.yml passed on
      # this commit: a required check can be bypassed by an admin, and a green
      # check on a PR is not a green check on the merge commit.
      - name: CI gate
        run: pnpm turbo run lint typecheck test build lint:pack

      - name: Licence boundary — manifests and sources
        run: node scripts/licence-boundary.mjs

      - name: Licence boundary — the tarball itself
        run: node scripts/licence-tarball.mjs

      - name: Vocabulary drift
        run: |
          pnpm --filter @quagga/scopes codegen:sdk
          git diff --exit-code packages/sdk/src/generated

      # PROVENANCE NEEDS A RECENT npm CLI, AND pnpm's OWN PUBLISH PATH IS NOT
      # THE ONE npm DOCUMENTS FOR OIDC.
      #
      # UNVERIFIED IN THIS SESSION (no network, node_modules absent): the exact
      # npm CLI minimum for trusted publishing, and whether pnpm 10.30 implements
      # the OIDC token exchange. Pre-flight before the first publish: run this
      # workflow against a scratch scope and confirm the package page shows a
      # provenance attestation. If pnpm turns out to work, drop this step.
      #
      # `changeset publish` shells out to the npm CLI, so installing a newer npm
      # is sufficient — pnpm is still what installed and built.
      - name: Install a current npm CLI
        run: npm install --global npm@latest

      - name: Publish
        run: pnpm exec changeset publish
        env:
          # Belt to the publishConfig.provenance braces in each package.json.
          NPM_CONFIG_PROVENANCE: "true"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

#### 8.3 Provenance and trusted publishing

| item         | setting                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package.json | `"publishConfig": { "access": "public", "provenance": true }` on both published packages                                                                                |
| workflow     | `permissions: id-token: write`, only in `publish.yml`                                                                                                                   |
| npm side     | register the trusted publisher on npmjs.com per package: repository `RyRy79261/afrikaburn-contributors-app`, workflow filename `publish.yml`, environment `npm-publish` |
| secret       | **none.** No `NPM_TOKEN` in repository secrets. A long-lived publish token in a public repository's secret store is the thing trusted publishing exists to delete.      |
| effect       | the npm package page shows the commit, the workflow run and the build that produced the tarball, verifiable with `npm audit signatures`                                 |

The trusted-publisher registration binds the workflow **filename**. Renaming `publish.yml` breaks
publishing until the registration is updated — record that in the file's own header when it is
written.

---

### 9. Deprecation policy

**The clock is the burn, not the calendar.** A deprecated method survives **two editions**.
`editions` is the root namespace of the whole data model (`packages/db/src/schema.ts`, seeded
"AfrikaBurn 2027, 2027-04-26 → 2027-05-02, active" per `docs/build-spec.md:102`), and an
integrator's release cycle is the burn's, not a vendor's six-month window. A camp tool written
before the 2027 burn must still run against the 2028 one.

| stage                | mechanic                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deprecate            | `@deprecated` JSDoc, **generated** from `deprecatedIn`/`removeAfterEdition` metadata in the registry — never hand-written, per decision 28 (documentation comes from the registry and the test matrix, never from prose). Editors render it as a strikethrough at the call site. |
| announce             | a `minor` release. The changelog entry names the replacement scope or method and the edition after which it goes.                                                                                                                                                                |
| warn at runtime      | the server sends `Deprecation` and `Sunset` headers on the operation; the SDK logs once per process per operation, never per call. A per-call warning is a log people filter, which is worse than silence.                                                                       |
| warn at construction | `ScopeContractError`'s sibling notice: `createServerClient` lists deprecated scopes in the declared tuple alongside the `unused` list (§3.4 of the architecture).                                                                                                                |
| remove               | a `major`, and no earlier than the close of the second edition after the deprecation shipped.                                                                                                                                                                                    |
| whole versions       | `npm deprecate '@afrikaburn/sdk@<1.0.0' "…"` for a version range that must not be used — a security fix, a wrong manifest shape. Distinct from method deprecation and never used for routine churn.                                                                              |

**dist-tags:** `latest` (the supported release) and `next` (pre-release). Nothing else — an
`edition-2027` tag invites integrators to pin to a tag that stops moving, and a stale pinned SDK
against a live rights model is the staleness failure the manifest TTL exists to prevent.

**What is never deprecated, only removed immediately:** a scope that turns out to expose data it
should not. `org:personal_information:*` is unissued at v0.1/v0.2 for exactly this reason
(decision 9, grounded in `apps/org/lib/queries.ts:952-960`). If a scope has to be withdrawn for a
privacy reason, it is a `major` on the same day, plus `npm deprecate` on every version that
carried it — the two-edition window is a courtesy to integrators, not a commitment that outranks
POPIA.

---

### 10. The docs site

**v0.1 and v0.2: no site.** The deliverables are:

| artefact                 | source                                                   | where                                                                                                        |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/sdk/README.md` | hand-written; ships in the tarball                       | the only prose most integrators read                                                                         |
| `docs/sdk/scopes.md`     | **generated** — `pnpm --filter @quagga/scopes docs:emit` | one section per scope: what it addresses, which predicate resolves it, the refusal sentence, the remediation |
| `docs/sdk/errors.md`     | generated from the error taxonomy                        |                                                                                                              |
| `docs/sdk/manifest.md`   | generated from the manifest type                         |                                                                                                              |

Both generated files are committed and drift-gated by the same step as the vocabulary. They join
the `docs/` index table in `README.md:196-211`, which already lists every spec.

Rejected: typedoc over the SDK source. The method surface is generated stubs, so typedoc would
produce a page per `Gate<S, "org:read:suppliers", …>` and nothing a human wants. Rejected:
doc-comments in `packages/core/src/org-permissions.ts` as a source — decision 28, and the survey
verified why: `DEPARTMENT_SCOPED_CAPABILITIES = ORG_CAPABILITIES` sits directly under a 24-line
comment arguing the opposite, and `SYSTEM_MANAGER_ONLY_CAPABILITIES` is `[]` while the prose
above it describes live capabilities that no longer exist. Generating integrator documentation
from that prose ships a permission model that is wrong in the permissive direction.

**v1.0: `apps/developers`** — a fourth Next app on port 3003, its own Vercel deployment at
`developers.afrikaburn.org`, built from the same generated registry. Not a third-party docs host:
that is a new vendor in the dependency list of a POPIA-holding platform, for a static site.

**The link problem, and it starts at v0.1.** The architecture's generated JSDoc carries
`@see https://developers.afrikaburn.org/scopes/org:update:suppliers`, and `Refusal.remediationUrl`
points at the same host. That host does not exist until v1.0, and a URL in a compile error that
404s is worse than no URL. Resolution: the emitter reads a single `DOCS_BASE` constant in
`packages/scopes/src/docs.ts`. At v0.1 it is the GitHub blob URL —

```
https://github.com/RyRy79261/afrikaburn-contributors-app/blob/main/docs/sdk/scopes.md#org-update-suppliers
```

— and at v1.0 it flips to `https://developers.afrikaburn.org/scopes/`, with the developers app
serving redirects from the old anchors. One constant, one regeneration, one drift-gate diff.
**This deviates from the literal URLs in the architecture's §3.3 code sample and is flagged for
review.**

---

### 11. Contributor workflow: testing against a local stack

Three layers, in order of how often they run.

#### 11.1 Unit — no stack, rides the gate

`packages/sdk/src/__tests__/**`, vitest, `fetch` injected as a stub. Covers the manifest
evaluator, `assertScopes`, the `ScopeContractError` diff, error mapping, and the type-level gates
(via `expectTypeOf`/`@ts-expect-error` assertions on `Deny<S>`). Runs in
`pnpm turbo run lint typecheck test build` and reports through the coverage matrix row added in
§4.3. This is the layer that must stay fast; it is where the anti-drift matrix test from the
architecture's §5 item 7 lives.

#### 11.2 Integration — a real local stack, opt-in

`pnpm sdk:local` — a new root script beside the existing `"e2e:local": "./scripts/e2e-local.sh"`
(`package.json:15`).

```bash
#!/usr/bin/env bash
# scripts/sdk-local.sh
#
# Run the SDK's integration tests against a real local stack — real Postgres,
# real Neon proxies, real route handlers, a real minted API key.
#
#   ./scripts/sdk-local.sh                    # the whole integration suite
#   ./scripts/sdk-local.sh -t "manifest"      # one grep
#
# WHY THIS IS NOT scripts/e2e-local.sh.
#
# That script is shared verbatim with CI (.github/workflows/ci.yml:278-283 calls
# it), boots all three apps and runs Playwright. The SDK needs one app
# (apps/web owns the v0.1 read tranche) and no browser. Forking it would mean
# two scripts drifting; extending it would slow every persona run down for a
# suite they do not use. It reuses the same compose file, the same migrator and
# the same seed, and diverges only after that.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.local.yml"
LOG_DIR="${TMPDIR:-/tmp}/quagga-sdk"
mkdir -p "$LOG_DIR"

# Identical to scripts/e2e-local.sh:23-27 — the DB host is the COMPOSE SERVICE
# NAME because the proxy resolves it, the proxy endpoints are localhost because
# we do.
export DATABASE_URL="postgres://postgres:postgres@postgres:5432/quagga"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export NEON_LOCAL_PROXY=1
export PGCRYPTO_KEY="${PGCRYPTO_KEY:-local-dev-pgcrypto-key-not-a-secret}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-local-dev-better-auth-secret-not-a-secret-32b}"
export GOD_EMAILS="${GOD_EMAILS:-e2e-god@quagga.local}"

echo "==> database stack"
$COMPOSE up -d
until docker exec quagga-pg pg_isready -U postgres -d quagga >/dev/null 2>&1; do sleep 1; done

echo "==> migrations + seed"
pnpm --filter @quagga/db db:migrate:deploy
pnpm --filter @quagga/db db:seed

# THE KEY. Minted against the local database, printed once, never persisted.
# The minting script refuses to run against anything that is not local — see
# below; that refusal is the only thing standing between this convenience and a
# production key in a developer's shell history.
echo "==> minting a local integration key"
AFRIKABURN_API_KEY="$(pnpm --filter @quagga/db exec tsx src/scripts/mint-local-key.mts)"
export AFRIKABURN_API_KEY
export AFRIKABURN_BASE_URL="http://localhost:3000"

echo "==> apps/web on :3000"
pkill -f "next start" >/dev/null 2>&1 || true
pnpm --filter @quagga/web build > "$LOG_DIR/build.log" 2>&1 \
  || { echo "!! build failed:"; tail -30 "$LOG_DIR/build.log"; exit 1; }
pnpm --filter @quagga/web start > "$LOG_DIR/dev.log" 2>&1 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true; pkill -f "next start" >/dev/null 2>&1 || true' EXIT

# FAIL IF THE APP NEVER COMES UP. scripts/e2e-local.sh learned this the hard
# way: a readiness loop that falls through silently makes every test look like a
# product failure.
echo -n "    waiting for :3000"
ready=0
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3000/; then echo " ok"; ready=1; break; fi
  echo -n "."; sleep 2
done
[ "$ready" -eq 1 ] || { echo " FAILED"; tail -30 "$LOG_DIR/dev.log"; exit 1; }

echo "==> sdk integration suite"
exec pnpm --filter @afrikaburn/sdk test:integration -- "$@"
```

**The production guard is the load-bearing part**, and it copies the shape of
`apps/web/app/api/account/deletion-sweep/route.ts` — refuse when the environment is not what the
script assumes, rather than proceeding on a default:

```ts
// packages/db/src/scripts/mint-local-key.mts
// SPDX-License-Identifier: FSL-1.1-ALv2
//
// Mints an integration + service user + API key against a LOCAL database and
// prints the plaintext key once, on stdout, for scripts/sdk-local.sh to capture.
//
// IT REFUSES TO RUN ANYWHERE ELSE. Not as a warning, not behind a --force flag.
// A developer convenience that can be pointed at production by editing one env
// var is how a real key ends up in a shell history and a CI log.
const url = process.env.DATABASE_URL ?? "";
const host = url.replace(/^\w+:\/\/[^@]*@/, "").split(/[:/]/)[0];

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "postgres",
  "host.docker.internal",
]);

if (process.env.NODE_ENV === "production") {
  throw new Error("mint-local-key refuses to run with NODE_ENV=production.");
}
if (process.env.NEON_LOCAL_PROXY !== "1") {
  throw new Error(
    "mint-local-key requires NEON_LOCAL_PROXY=1 (the local compose stack).",
  );
}
if (!LOCAL_HOSTS.has(host)) {
  throw new Error(
    `mint-local-key refuses to run against host "${host}". ` +
      `Permitted: ${[...LOCAL_HOSTS].join(", ")}. This is not overridable.`,
  );
}
if (/neon\.tech|vercel|amazonaws/i.test(url)) {
  throw new Error("mint-local-key refuses to run against a hosted database.");
}

// … create integrations row + service user + api_keys row,
// assert isSystemManager(serviceActor) === false before returning, print the key.
```

**NONE of those three tables/columns exists yet, and this shard does not create them.** Verified
against `packages/db/src/schema.ts`: there is no `integrations` table, no `api_keys`/`apikey`
table (better-auth's own tables are `user`/`session`/`account`/`verification`/`two_factor`/
`passkey`, `:358-573`), and `users` (`:283`) has columns `id`, `auth_user_id`, `email`,
`username`, `sanitized_at`, `created_at` — **no `kind`**. The API-key storage model is the
architecture shard's to specify; this script consumes it. It lands as a NEW append-only migration
authored there, under `/packages/db/migrations/ @RyRy79261` and `/packages/db/src/schema.ts
@RyRy79261` (`.github/CODEOWNERS:21-22`), and it does not amend an existing migration
(`docs/build-spec.md:23` hard constraint 5: the schema is frozen and migrations are append-only,
never hand-edited). `scripts/sdk-local.sh` cannot be written until that migration exists.

Two invariants the script asserts before it prints anything, matching the architecture's §5 item 6:
the service user is not a System manager, and holds no camp `lead`/`admin` membership. If either
fails it throws rather than printing a key — a local key with a backstop is a local test that
proves the wrong thing.

`sdk:local` is **not** wired into `turbo run` and **not** in the CI gate, for the same reason
`e2e:local` is not (`scripts/e2e-local.sh:8-12`): it needs a database and a running app, and
putting that in the fast gate makes the fast gate slow and flaky. It gets its own job in CI once
the v0.1 endpoints land — modelled on the `e2e` job, one shard, `timeout-minutes: 15`.

#### 11.3 Persona — v1.0, through the Integrations console

Once the Integrations console screen exists (architecture §5 item 15), an `integrator` persona
joins the `e2e` matrix in `ci.yml:139-163` and mints its key **through the UI**, which is what
`@quagga/e2e`'s own package.json `description` requires, verbatim: _"Drives the REAL UI against a
deployed preview — no DB back doors."_ Until that
screen exists there is no UI to drive, which is precisely why §11.2 uses a script and why the
script is guarded rather than trusted.

Matrix row, when it lands:

```yaml
- persona: integrator
  label: "integrator · API key scopes, manifest, refusals"
  side: web
```

---

### 12. Ordered change list

Numbered so a PR can cite one. **[B]** blocks v0.1.

| #          | change                                                                                                                                                                                                                                                                                                   | files                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 **[B]**  | commitlint scopes `scopes`, `sdk`, `react`                                                                                                                                                                                                                                                               | `commitlint.config.mjs:16-31`, `CONTRIBUTING.md:158-165`                                                                                                                                       |
| 2 **[B]**  | `packages/scopes` — Apache-2.0-at-birth vocabulary, zod-free `as const` tuples; invert ALL THREE existing tuples so no duplicate remains: `roles.ts:150` → `z.enum(ORG_CAPABILITY_KEYS)`, `roles.ts:262-271` → `z.enum(CAMP_PERMISSIONS)`, and `org-domains.ts:72` → re-export `ORG_DOMAINS` from scopes | new workspace; `packages/types/src/roles.ts` + `packages/types/package.json` (add `"@quagga/scopes": "workspace:*"`); `packages/core/src/org-domains.ts` + `packages/core/package.json` (same) |
| 3 **[B]**  | the two generators (`emit-sdk-vocabulary.mts`, `emit-scope-docs.mts`) and the committed output                                                                                                                                                                                                           | `packages/scopes/scripts/`, `packages/sdk/src/generated/`, `docs/sdk/`                                                                                                                         |
| 4 **[B]**  | `packages/sdk` — tsdown, `node.json` tsconfig, exports map, eslint wall, `server.browser.ts`, `publint`+`attw` as `lint:pack`                                                                                                                                                                            | new workspace                                                                                                                                                                                  |
| 4b **[B]** | `turbo.json` — add the `lint:pack` task (`dependsOn: ["build"]`); it is the only turbo.json change, and it is required because `lint` (`turbo.json:52-55`) depends on `^build` only                                                                                                                      | `turbo.json`, and `ci.yml:102` gains `lint:pack`                                                                                                                                               |
| 5 **[B]**  | `packages/sdk/LICENSE` + `NOTICE`; SPDX headers across sdk/scopes and across `packages/core/src`, `packages/types/src`                                                                                                                                                                                   | new + ~66 existing files                                                                                                                                                                       |
| 6 **[B]**  | `scripts/licence-boundary.mjs`, `scripts/licence-tarball.mjs`                                                                                                                                                                                                                                            | new                                                                                                                                                                                            |
| 7 **[B]**  | ci.yml — three coverage matrix rows, three new steps in the `ci` job, changeset-status step                                                                                                                                                                                                              | `.github/workflows/ci.yml:383-411`, `:101-102`                                                                                                                                                 |
| 8 **[B]**  | licence prose corrections                                                                                                                                                                                                                                                                                | `README.md:10`, `README.md:218-224`, `AGENTS.md:34-35`, `AGENTS.md:40-43`, `docs/build-spec.md:20`, `.github/CODEOWNERS`                                                                       |
| 9 **[B]**  | changesets: root devDependency + `.changeset/config.json`                                                                                                                                                                                                                                                | new                                                                                                                                                                                            |
| 10 **[B]** | `release-pr.yml`, `publish.yml`                                                                                                                                                                                                                                                                          | new. `ci.yml` permissions untouched.                                                                                                                                                           |
| 11 **[B]** | npm org created and owned by AfrikaBurn; `@afrikaburn/sdk`, `@afrikaburn/react`, `@afrikaburn/cli` reserved at `0.0.1-alpha.0 --tag next`                                                                                                                                                                | external                                                                                                                                                                                       |
| 12 **[B]** | `scripts/sdk-local.sh` + `packages/db/src/scripts/mint-local-key.mts` with the refusal guard. **BLOCKED ON** the API-key schema (no `integrations` table, no api-key table, no `users.kind` column exists today — §11.2), which lands as a new append-only migration owned by the architecture shard     | new; `package.json` `"sdk:local"`; depends on `packages/db/migrations/` + `packages/db/src/schema.ts`                                                                                          |
| 13         | `packages/sdk-react` — same shape, `"use client"` preservation verified in `dist`                                                                                                                                                                                                                        | v0.2                                                                                                                                                                                           |
| 14         | switch `ci.yml`'s installs to `--frozen-lockfile`                                                                                                                                                                                                                                                        | `ci.yml:99`, `:59`, `:179`, `:457`                                                                                                                                                             |
| 15         | the scope-change-requires-major CI gate                                                                                                                                                                                                                                                                  | v1.0                                                                                                                                                                                           |
| 16         | `apps/developers` and the `DOCS_BASE` flip                                                                                                                                                                                                                                                               | v1.0                                                                                                                                                                                           |

---

### 13. Definition of done for the publishing work

Copied from the architecture's v0.1 proof list, narrowed to what this shard owns:

- `pnpm turbo run lint typecheck test build lint:pack` green with three new workspaces in it, and
  `dependsOn: ["^build"]` demonstrably ordering `sdk` before `react`.
- `node scripts/licence-boundary.mjs` and `node scripts/licence-tarball.mjs` green — **and
  demonstrated red**: add `import { orgCan } from "@quagga/core"` to `packages/sdk/src/index.ts`,
  watch both fail with different messages, revert. Put that commit hash in
  `packages/sdk/README.md`, next to the deliberately-red PII build from the architecture's §7.
- `publint` and `attw --pack` clean on both packages.
- A published tarball containing **zero** files from `packages/core`, `packages/types`,
  `packages/db` or `packages/auth`, and `"dependencies": {}` on `@afrikaburn/sdk`.
- `npm audit signatures` verifies the provenance attestation on the published version.
- `pnpm sdk:local` works from cold on a clean machine, and `mint-local-key` refuses when
  `DATABASE_URL` points anywhere but the compose stack.
- The generated `docs/sdk/scopes.md` and `packages/sdk/src/generated/vocabulary.ts` both survive
  `git diff --exit-code` after regeneration.
