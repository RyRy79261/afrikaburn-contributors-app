import { Database } from "lucide-react";
import { missingConfig } from "@/lib/config";

/**
 * Shown on a DB-backed page that cannot render real data yet. Keeps the shell
 * honest instead of throwing (build-spec §Hard constraints 4).
 *
 * IT HAS ALWAYS HAD TWO CAUSES AND NAMED ONLY ONE. A missing env var is the
 * obvious one. The other is a database that is wired up correctly but holds no
 * active edition — migrations run during the build (`db:migrate:deploy &&
 * next build`), seeds do NOT, so a first deployment has tables and no reference
 * data. That case rendered "Waiting on: configuration — connect Neon Postgres
 * and Neon Auth" at someone who had already connected Neon correctly, sending
 * them back to re-check env vars that were fine. It cost real time on the first
 * real deployment.
 *
 * So: when nothing is missing from the environment, say what is ACTUALLY
 * missing. ("Neon Auth" is also gone from the copy — auth is self-hosted here.)
 */
export function PreviewNotice({
  feature,
  reason,
}: {
  feature: string;
  /** Override when the cause is known and is not configuration. */
  reason?: string;
}) {
  const missing = reason ?? missingConfig().join(", ");

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-6">
      <Database className="h-5 w-5 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">Preview mode</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {feature} needs a live connection.{" "}
        {missing ? (
          <>Waiting on: {missing}.</>
        ) : (
          <>
            The database is connected, but it has no active edition — it has not
            been seeded. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              pnpm --filter @quagga/db db:seed
            </code>{" "}
            against it.
          </>
        )}{" "}
        Everything you see is a working shell.
      </p>
    </div>
  );
}
