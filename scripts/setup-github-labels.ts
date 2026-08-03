// Sync the issue label taxonomy to the GitHub repository: `pnpm labels:sync`.
//
// The taxonomy itself lives in @quagga/core (`src/report.ts`), which is also
// what the in-app reporter labels issues with — one list, so a label the
// reporter applies can never be one the repository has never heard of.
//
// Needs GITHUB_TOKEN (with Issues write on the target repo) and, optionally,
// GITHUB_REPO. This is a one-off maintenance task, not part of any deploy.

import {
  parseRepoSlug,
  syncGithubLabels,
} from "../packages/core/src/report-server/labels-sync";

const DEFAULT_REPO = "RyRy79261/afrikaburn-contributors-app";

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is not set. Nothing to do.");
    process.exit(1);
  }

  const slug = process.env.GITHUB_REPO || DEFAULT_REPO;
  const target = parseRepoSlug(slug);
  if (!target) {
    console.error(`GITHUB_REPO is not owner/repo: ${slug}`);
    process.exit(1);
  }

  console.log(`Syncing labels to ${target.owner}/${target.repo}…`);
  const result = await syncGithubLabels({ token, ...target });

  console.log(`  created: ${result.created.length}`);
  console.log(`  updated: ${result.updated.length}`);
  if (result.failed.length > 0) {
    console.error(`  failed:  ${result.failed.length}`);
    for (const failure of result.failed) {
      console.error(`    ${failure.name} (HTTP ${failure.status})`);
    }
    // A partial sync leaves the reporter able to apply a label the repo does
    // not have, so this is a failure rather than a warning.
    process.exit(1);
  }
}

void main();
