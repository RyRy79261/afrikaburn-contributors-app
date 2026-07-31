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

/** Workspace names with the `@quagga/` prefix dropped, plus `repo` for the root. */
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
