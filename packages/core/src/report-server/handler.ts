// The route handler behind the in-app reporter, shared by all three apps.
//
// It is a FACTORY rather than a route because the three apps do not agree on
// what "signed in" means — a camp user, a console session with an org role, a
// supplier linked to a company — and each one already owns that answer. Both
// the gate and the rate limiter are injected, so this file never imports
// `@quagga/db` (which depends on this package) or `next`.
//
// Pipeline: gate → rate limit → validate → sanitize → (optionally) structure →
// assemble → file. Sanitization happens inside `assembleIssue`, which every
// path goes through, so no field can reach GitHub without passing it.

import {
  REPORT_DESCRIPTION_MAX,
  ReportRequestSchema,
  assembleIssue,
  type ReportResponse,
  type ReportSurface,
} from "../report";
import { sanitizeReportText } from "../report-sanitize";
import { screenReport } from "../report-screen";
import { createIssue, githubConfigured } from "./github";
import { structureReport, structuringConfigured } from "./structure";

/**
 * How many reports one account may file per hour.
 *
 * Any signed-in user can file, and every issue is published under the
 * maintainer's GitHub account, so this is the ceiling on how much a single
 * account can put there. Five is generous for somebody genuinely hitting bugs
 * and low enough that abuse is a nuisance rather than an incident.
 */
export const REPORTS_PER_HOUR = 5;
const RATE_WINDOW_SECONDS = 60 * 60;

/** The signed-in reporter. `id` is for the audit line and is never published. */
export interface ReportViewer {
  id: string;
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ReportHandlerOptions {
  surface: ReportSurface;
  /**
   * The app's own gate. Returns null when nobody is signed in — the handler
   * never guesses at identity, and an unauthenticated caller gets a 401 before
   * anything else runs.
   */
  identify: () => Promise<ReportViewer | null>;
  /** The app passes `consumeRateLimit` from `@quagga/db`. */
  consumeRateLimit: (input: {
    key: string;
    max: number;
    windowSeconds: number;
  }) => Promise<RateLimitVerdict>;
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** What the reporter is told when GitHub refuses. */
const FAILURE_MESSAGES: Record<string, string> = {
  "not-configured":
    "Reporting isn't switched on for this deployment yet. Nothing was sent.",
  "bad-repo": "Reporting is misconfigured on the server. Nothing was sent.",
  "bad-token": "Reporting is misconfigured on the server. Nothing was sent.",
  "no-access": "Reporting is misconfigured on the server. Nothing was sent.",
  "issues-disabled":
    "Reporting is switched off on the receiving repository. Nothing was sent.",
  rejected: "The report was refused by GitHub. Nothing was filed.",
  unavailable: "We couldn't reach GitHub. Please try again in a minute.",
};

export function createReportHandler(
  options: ReportHandlerOptions,
): (request: Request) => Promise<Response> {
  const { surface, identify, consumeRateLimit } = options;

  return async function POST(request: Request): Promise<Response> {
    const viewer = await identify();
    if (!viewer) {
      return json({ error: "Sign in to report a problem." }, 401);
    }

    // Checked before any work: a deployment without a token cannot file, and
    // saying so up front beats letting somebody type out a bug report first.
    if (!githubConfigured()) {
      return json(
        { error: FAILURE_MESSAGES["not-configured"], code: "not-configured" },
        503,
      );
    }

    // Keyed on the account, not the IP. Auth is required, so the account is the
    // stronger key — a shared office NAT would otherwise put a whole camp on
    // one budget.
    const verdict = await consumeRateLimit({
      key: `report:${viewer.id}`,
      max: REPORTS_PER_HOUR,
      windowSeconds: RATE_WINDOW_SECONDS,
    });
    if (!verdict.allowed) {
      return json(
        {
          error: `That's ${REPORTS_PER_HOUR} reports this hour. Please add to an existing one instead.`,
          code: "rate-limited",
        },
        429,
        { "Retry-After": String(verdict.retryAfterSeconds) },
      );
    }

    const payload: unknown = await request.json().catch(() => null);
    const parsed = ReportRequestSchema.safeParse(payload);
    if (!parsed.success) {
      // The issues are returned so the form can point at the offending field;
      // the submitted VALUES are deliberately not echoed back.
      return json(
        {
          error: "That report couldn't be read.",
          code: "invalid",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    const report = parsed.data;

    // SCREEN BEFORE THE MODEL. The screen reads the reporter's raw words, so it
    // has to run before anything rewrites them — and a report that asks for data
    // to be sent somewhere must not be handed to a model at all, structuring or
    // not. Its verdict decides the labels and whether diagnostics are published.
    const redaction = sanitizeReportText(
      report.description,
      REPORT_DESCRIPTION_MAX,
    );
    const screen = screenReport(report.description, redaction.redacted);

    // Does anything survive redaction? `assembleIssue` sanitizes again — this
    // is not that pass, it is the question of whether there is a report left to
    // file. A description that is entirely markup, or entirely a phone number,
    // would otherwise become an empty issue under the maintainer's name (and
    // would spend a model call on the way there).
    if (!redaction.text) {
      return json(
        {
          error:
            "There was nothing left to file once personal data was removed. Please describe the problem without naming anyone.",
          code: "empty-after-redaction",
        },
        400,
      );
    }

    // A flagged report is filed VERBATIM, from the template. Restructuring text
    // that is trying to steer its reader means handing it to a model first, and
    // the model's rewrite is what a person would then read instead of the
    // original — so the one report that most needs reading as written is the one
    // that gets paraphrased. Not worth it.
    const structured =
      !screen.needsHuman && report.useAi && structuringConfigured()
        ? await structureReport(report.type, report.description)
        : null;

    const issue = assembleIssue({
      type: report.type,
      surface,
      description: report.description,
      structured,
      dictated: report.dictated,
      diagnostics: report.diagnostics,
      flags: screen.flags,
      withholdDiagnostics: screen.withholdDiagnostics,
    });

    const result = await createIssue(issue);
    if (!result.ok) {
      console.error(
        `[report] filing failed (${result.failure}) from ${surface}: ${result.detail}`,
      );
      return json(
        {
          error: FAILURE_MESSAGES[result.failure] ?? FAILURE_MESSAGES.unavailable,
          code: result.failure,
        },
        result.failure === "unavailable" ? 502 : 503,
      );
    }

    // The ONLY place the reporter's identity is written down. The issue itself
    // carries no account id, because the repository is public — this line is
    // how a follow-up question stays answerable.
    console.log(
      `[AUDIT] report filed as issue #${result.issue.number} from ${surface} by user ${viewer.id}` +
        `${structured ? " (structured)" : " (template)"}` +
        `${screen.flags.length > 0 ? ` FLAGGED: ${screen.flags.join(",")}` : ""}`,
    );

    const body: ReportResponse = {
      url: result.issue.url,
      number: result.issue.number,
    };
    return json(body, 201);
  };
}
