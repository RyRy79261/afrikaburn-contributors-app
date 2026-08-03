// Creating the issue.
//
// One endpoint, so plain `fetch` rather than Octokit — the dependency would buy
// nothing here and this package is imported by three Next apps.
//
// The token is the MAINTAINER'S. Every issue this creates is authored by a real
// person's GitHub account from words somebody else typed, which is why the body
// says so and why `needs-triage` is not optional. See `../report.ts`.

const GITHUB_API = "https://api.github.com";
/** The repository this product's issues live in, unless overridden. */
const DEFAULT_REPO = "RyRy79261/afrikaburn-contributors-app";

export interface CreatedIssue {
  url: string;
  number: number;
}

/**
 * Why a filing attempt failed, in terms the route can turn into an honest
 * message. Every one of these is a server-side misconfiguration except
 * `unavailable`, so the reporter is told "we could not file this" rather than
 * being asked to fix something they cannot see.
 */
export type IssueFailure =
  | "not-configured"
  | "bad-repo"
  | "bad-token"
  | "no-access"
  | "issues-disabled"
  | "rejected"
  | "unavailable";

export type IssueResult =
  | { ok: true; issue: CreatedIssue }
  | { ok: false; failure: IssueFailure; detail: string };

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

/** `owner/repo` split, refusing anything that is not exactly that. */
function parseRepo(slug: string): { owner: string; repo: string } | null {
  const segments = slug.trim().split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0]?.trim();
  const repo = segments[1]?.trim();
  if (!owner || !repo) return null;
  return { owner, repo };
}

export async function createIssue(input: {
  title: string;
  body: string;
  labels: string[];
}): Promise<IssueResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      ok: false,
      failure: "not-configured",
      detail: "GITHUB_TOKEN is unset",
    };
  }

  const target = parseRepo(process.env.GITHUB_REPO || DEFAULT_REPO);
  if (!target) {
    return {
      ok: false,
      failure: "bad-repo",
      detail: "GITHUB_REPO is not owner/repo",
    };
  }

  // GitHub can be slow or wedged; a report is not worth holding a serverless
  // invocation open indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(
      `${GITHUB_API}/repos/${target.owner}/${target.repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "quagga-portal-reporter",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      },
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      failure: "unavailable",
      detail: aborted ? "GitHub timed out" : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Never logged or returned wholesale — a GitHub error body can echo the
    // request, and the request is the report.
    const detail = `GitHub ${response.status}`;
    switch (response.status) {
      case 401:
        return { ok: false, failure: "bad-token", detail };
      case 403: {
        // 403 is BOTH "this token may not" and "you are being throttled" —
        // secondary rate limits and abuse detection come back 403 with a
        // retry hint. Calling a throttled request "misconfigured" tells the
        // reporter to give up on something that would work in a minute.
        const throttled =
          response.headers.get("retry-after") !== null ||
          response.headers.get("x-ratelimit-remaining") === "0";
        return {
          ok: false,
          failure: throttled ? "unavailable" : "no-access",
          detail,
        };
      }
      case 429:
        // Primary rate limit. Transient by definition.
        return { ok: false, failure: "unavailable", detail };
      case 404:
        // What GitHub returns for a token that cannot see the repository at
        // all — the same problem as a 403 that is not throttling.
        return { ok: false, failure: "no-access", detail };
      case 410:
        return { ok: false, failure: "issues-disabled", detail };
      case 422:
        // Usually a label that does not exist on the repository — run
        // `scripts/setup-github-labels.ts`.
        return { ok: false, failure: "rejected", detail };
      default:
        return { ok: false, failure: "unavailable", detail };
    }
  }

  const payload = (await response.json().catch(() => null)) as {
    html_url?: unknown;
    number?: unknown;
  } | null;

  if (
    !payload ||
    typeof payload.html_url !== "string" ||
    typeof payload.number !== "number"
  ) {
    // The issue may well have been created; we just cannot say where. Report
    // the failure rather than returning a link that goes nowhere.
    return {
      ok: false,
      failure: "unavailable",
      detail: "GitHub returned an unrecognised issue payload",
    };
  }

  return {
    ok: true,
    issue: { url: payload.html_url, number: payload.number },
  };
}
