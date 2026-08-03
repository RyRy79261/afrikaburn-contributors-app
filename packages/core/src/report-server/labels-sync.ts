// Syncing the label taxonomy to the repository.
//
// The reporter applies `needs-triage`, `source: in-app`, a `type:` and an
// `app:` label to every issue it files. GitHub will happily invent a label it
// has never seen — grey, undescribed — so without this the queue fills up with
// labels that look like typos and carry no colour signal at all.
//
// Run it from the repo root: `pnpm labels:sync`. Idempotent: existing labels
// are updated in place (colour and description), missing ones created, and
// labels NOT in the list are left completely alone — this owns its taxonomy,
// not the repository's.

import { GITHUB_LABELS, type GithubLabel } from "../report";

const GITHUB_API = "https://api.github.com";

export interface LabelSyncResult {
  created: string[];
  updated: string[];
  failed: { name: string; status: number }[];
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "quagga-portal-label-sync",
  };
}

/**
 * Create or update every label in `GITHUB_LABELS` on `owner/repo`.
 *
 * Throws only on a broken configuration; a per-label failure is collected and
 * reported so one bad label does not abandon the rest half-applied.
 */
export async function syncGithubLabels(input: {
  token: string;
  owner: string;
  repo: string;
  labels?: readonly GithubLabel[];
}): Promise<LabelSyncResult> {
  const { token, owner, repo } = input;
  const labels = input.labels ?? GITHUB_LABELS;
  const base = `${GITHUB_API}/repos/${owner}/${repo}/labels`;
  const result: LabelSyncResult = { created: [], updated: [], failed: [] };

  for (const label of labels) {
    // Names contain a space and a colon, so they must be encoded — an
    // unencoded `type: bug` requests a label GitHub has no record of and every
    // update silently becomes a create.
    const existing = await fetch(`${base}/${encodeURIComponent(label.name)}`, {
      headers: headers(token),
    });

    if (existing.status === 404) {
      const created = await fetch(base, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(label),
      });
      if (created.ok) result.created.push(label.name);
      else result.failed.push({ name: label.name, status: created.status });
      continue;
    }

    if (!existing.ok) {
      result.failed.push({ name: label.name, status: existing.status });
      continue;
    }

    const updated = await fetch(`${base}/${encodeURIComponent(label.name)}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({
        new_name: label.name,
        color: label.color,
        description: label.description,
      }),
    });
    if (updated.ok) result.updated.push(label.name);
    else result.failed.push({ name: label.name, status: updated.status });
  }

  return result;
}

/** `owner/repo` → parts, or null. Shared with the issue-filing path's rules. */
export function parseRepoSlug(
  slug: string,
): { owner: string; repo: string } | null {
  const segments = slug.trim().split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0]?.trim();
  const repo = segments[1]?.trim();
  if (!owner || !repo) return null;
  return { owner, repo };
}
