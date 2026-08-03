// SERVER ONLY — reached as `@quagga/core/report-server`, never through the
// package barrel.
//
// The separation is load-bearing rather than tidiness. `@quagga/core` is
// imported by client components all over the three apps; if these modules were
// re-exported from `src/index.ts`, every one of those bundles would pull in the
// Anthropic SDK and code that reads `process.env.GITHUB_TOKEN`. The token would
// not leak (Next replaces server env with undefined in a client bundle), but
// shipping the filing machinery to the browser is the kind of thing that stops
// being harmless the moment somebody adds a convenience export.
//
// The pure half — schemas, caps, labels, issue assembly — stays in `../report`
// and IS exported from the barrel, so client code can share the contract.

export {
  createReportHandler,
  REPORTS_PER_HOUR,
  type RateLimitVerdict,
  type ReportHandlerOptions,
  type ReportViewer,
} from "./handler";

export {
  createTranscribeHandler,
  transcriptionConfigured,
  TRANSCRIPTIONS_PER_HOUR,
  type TranscribeHandlerOptions,
  type TranscribeResponse,
} from "./transcribe";

export { githubConfigured } from "./github";
export { structuringConfigured } from "./structure";
