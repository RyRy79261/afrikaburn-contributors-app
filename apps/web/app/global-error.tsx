"use client";

// Last-resort boundary: fires only when the ROOT layout itself throws, so it must
// supply its own <html>/<body> (it replaces the root layout entirely). Kept
// dependency-light and inline-styled so it renders even if the design CSS or the
// font failed to load — the very failures that would trip this boundary.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#17191b",
          color: "#f5f3ef",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75, margin: "0 0 1.5rem" }}>
            The app hit an unexpected error. Try again — if it keeps happening, an
            organiser can help.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.6875rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                opacity: 0.6,
                margin: "0 0 1.5rem",
              }}
            >
              Ref {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "none",
              background: "#e6633a",
              color: "#17191b",
              fontWeight: 600,
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
