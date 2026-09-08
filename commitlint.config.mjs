// Commit-message rules for the Quagga Portal monorepo.
//
// Conventional Commits with a WORKSPACE SCOPE — see CONTRIBUTING.md. Enforced in
// two places, because this repo MERGES pull requests rather than squashing them,
// so every individual commit lands on `main` and the PR title is not the only
// thing anyone reads:
//
//   · locally, by the `commit-msg` git hook (.husky/commit-msg)
//   · in CI, over the PR title AND every commit in the range (.github/workflows/ci.yml)
//
// Keep `SCOPES` in step with the workspaces. A scope that is not listed fails,
// which is the point: `fix(accounts):` looks reasonable and names nothing that
// exists, and a scope vocabulary nobody prunes stops meaning anything.

/**
 * The scope vocabulary. Three kinds, and the difference matters:
 *   · workspace names with their npm scope dropped — @quagga/* AND @afrikaburn/*
 *   · `api`  — the /v1 HTTP surface, which lives inside apps/web rather than in a
 *              workspace of its own. It gets a scope anyway: without one, every
 *              server-side commit in that workstream is scoped `web` or `core` and
 *              the whole thing is invisible in `git log --oneline`.
 *   · `repo` — root-level turbo/tooling/CI/docs about the repo itself
 */
const SCOPES = [
  // apps/*
  "web",
  "org",
  "suppliers",
  // packages/*
  "core",
  "db",
  "ui",
  "auth",
  "types",
  // packages/* — the published pair and its vocabulary source.
  // NOTE: `sdk` and `react` are @afrikaburn/*, not @quagga/*. The directory is
  // packages/sdk-react; the scope is `react`, matching the PACKAGE name, because
  // that is what a reader recognises in a changelog.
  "scopes",
  "sdk",
  "react",
  // the public HTTP surface — apps/web/app/api/v1/**. Not a workspace.
  "api",
  // the e2e workspace
  "e2e",
  // root-level: turbo, workspace tooling, CI, docs about the repo itself
  "repo",
];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", SCOPES],
    // 72, not the conventional default of 100. GitHub truncates list views around
    // there, and a title that only makes sense once expanded is a title nobody
    // reads — which was the original complaint.
    "header-max-length": [2, "always", 72],
    // Bodies wrap at 100 by default; ours run to prose paragraphs explaining WHY,
    // and hard-wrapping a URL or a quoted error string mid-token to satisfy a
    // linter makes the message worse. Warn rather than fail.
    "body-max-line-length": [1, "always", 100],
    "footer-max-line-length": [1, "always", 100],
  },
  // `Merge pull request #N from …` is written by GitHub, not by a human, and it
  // cannot be conventional. Same for revert commits git generates itself.
  ignores: [
    (message) => /^Merge (branch|pull request|remote-tracking)/.test(message),
    (message) => /^Revert "/.test(message),
  ],
};
