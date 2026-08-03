// The recent-errors buffer the in-app reporter attaches to a report.
//
// A bug report that says "it broke" is nearly useless; the same report with the
// three console errors that preceded it is usually enough to find the fault
// without going back to the person. This is the thing that collects them.
//
// ## It is a buffer, not a log
//
// Nothing here is persisted or transmitted on its own. Entries live in memory,
// die with the tab, and leave the device only if somebody opens the reporter
// and submits — at which point they go through the redaction pass in
// `@quagga/core` `report-sanitize.ts` on the way to a PUBLIC GitHub issue.
//
// That destination is why the caps below are hard rather than advisory. An
// error message on this product routinely contains the payload that failed to
// render, and on these screens that payload is somebody's phone number,
// emergency contact or medical note. Truncating here means less of it exists to
// leak later, and it also means the server never rejects a report for being
// over the schema's limits.

import {
  REPORT_LOGS_MAX,
  REPORT_LOG_MESSAGE_MAX,
  REPORT_LOG_STACK_MAX,
  REPORT_ENV_FIELDS_MAX,
  REPORT_ENV_VALUE_MAX,
  type EnvField,
  type ReportErrorLog,
} from "@quagga/core";

/** Newest last. Trimmed to `REPORT_LOGS_MAX` on every push. */
const buffer: ReportErrorLog[] = [];

let installed = false;

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function record(entry: {
  source: string;
  message: string;
  stack?: string;
}): void {
  const log: ReportErrorLog = {
    timestamp: Date.now(),
    source: clamp(entry.source, 40),
    message: clamp(entry.message, REPORT_LOG_MESSAGE_MAX),
  };
  if (entry.stack) log.stack = clamp(entry.stack, REPORT_LOG_STACK_MAX);
  // The path, never the query string or hash: those carry tokens, invite codes
  // and search terms, and this value ends up in a public issue.
  if (typeof window !== "undefined") {
    log.route = clamp(window.location.pathname, 300);
  }

  buffer.push(log);
  // Drop the oldest rather than refusing the newest — the errors immediately
  // before someone reaches for the reporter are the ones that matter.
  while (buffer.length > REPORT_LOGS_MAX) buffer.shift();
}

/** Best-effort rendering of whatever was thrown; never throws itself. */
function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, stack: value.stack };
  }
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

/**
 * Start capturing. Idempotent and safe to call on every mount; a no-op during
 * server rendering.
 *
 * Returns a teardown function, so a caller that mounts this in a component can
 * unhook on unmount. Once installed, a second call returns a no-op teardown
 * rather than removing the first installation's handlers.
 */
export function installClientErrorCapture(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;

  const onError = (event: ErrorEvent) => {
    const described = describe(event.error ?? event.message);
    record({ source: "window.error", ...described });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    record({ source: "unhandledrejection", ...describe(event.reason) });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  // React reports render and hydration failures through console.error and
  // nowhere else, so without this the most diagnostic errors in a Next app
  // never reach a report.
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    // Pass through FIRST and unconditionally. Whatever happens below, the
    // browser console must show what it would have shown.
    originalConsoleError.apply(console, args as never[]);
    try {
      const first = args[0];
      const described = describe(first);
      const rest = args
        .slice(1)
        .map((arg) => (typeof arg === "string" ? arg : describe(arg).message))
        .join(" ");
      record({
        source: "console.error",
        message: rest ? `${described.message} ${rest}` : described.message,
        ...(described.stack ? { stack: described.stack } : {}),
      });
    } catch {
      // Capturing an error must never itself throw — that would turn a logged
      // error into an uncaught one, inside the console.error handler.
    }
  };

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    console.error = originalConsoleError;
    installed = false;
  };
}

/** A copy of the buffer, oldest first. Safe to mutate. */
export function recentClientErrors(): ReportErrorLog[] {
  return buffer.map((entry) => ({ ...entry }));
}

/** Empty the buffer — for tests, and for a "don't attach these" control. */
export function clearClientErrors(): void {
  buffer.length = 0;
}

/**
 * Environment facts worth attaching to a report.
 *
 * Everything here is about the DEVICE, never the person: no account id, no
 * email, no camp. The list is short on purpose — it is published, and the
 * questions it needs to answer are "which build, which browser, how wide".
 */
export function collectEnvironment(extra: EnvField[] = []): EnvField[] {
  const fields: EnvField[] = [
    {
      label: "App version",
      value: process.env.NEXT_PUBLIC_APP_VERSION || "unknown",
    },
    {
      label: "Build env",
      value: process.env.NEXT_PUBLIC_VERCEL_ENV || "unknown",
    },
  ];

  if (typeof navigator !== "undefined") {
    fields.push({ label: "User agent", value: navigator.userAgent });
    fields.push({ label: "Locale", value: navigator.language });
    fields.push({ label: "Online", value: navigator.onLine ? "yes" : "no" });
  }
  if (typeof window !== "undefined") {
    fields.push({
      label: "Viewport",
      value: `${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`,
    });
    fields.push({
      label: "Screen",
      value: `${window.screen.width}×${window.screen.height}`,
    });
    fields.push({ label: "Path", value: window.location.pathname });
    try {
      fields.push({
        label: "Timezone",
        value: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch {
      // Some locked-down browsers refuse this; a missing field is fine.
    }
  }

  // Clamped to the schema's caps so a long user-agent string can never be the
  // reason a report is refused.
  return [...fields, ...extra]
    .slice(0, REPORT_ENV_FIELDS_MAX)
    .map((field) => ({
      label: clamp(field.label, 60),
      value: clamp(field.value, REPORT_ENV_VALUE_MAX),
    }));
}
