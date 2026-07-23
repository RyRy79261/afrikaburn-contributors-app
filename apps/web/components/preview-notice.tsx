import { Database } from "lucide-react";
import { missingConfig } from "@/lib/config";

/** Shown on a DB-backed page when the database (or auth) isn't configured yet.
 * Keeps the shell honest instead of throwing (build-spec §Hard constraints 4). */
export function PreviewNotice({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-6">
      <Database className="h-5 w-5 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">Preview mode</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {feature} needs a live connection. Waiting on:{" "}
        {missingConfig().join(", ") || "configuration"}. Everything you see is a
        working shell — connect Neon Postgres and Neon Auth to bring it to life.
      </p>
    </div>
  );
}
