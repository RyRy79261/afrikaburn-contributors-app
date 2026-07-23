import { TriangleAlert } from "lucide-react";
import { missingConfig } from "@/lib/config";

/**
 * Renders a calm heads-up banner listing the backing services still to be
 * configured, or nothing when everything is set. The app deliberately boots and
 * renders without env; this makes the degraded state honest instead of broken.
 */
export function NotConfiguredBanner() {
  const missing = missingConfig();
  if (missing.length === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <TriangleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
        aria-hidden
      />
      <div>
        <p className="font-medium text-foreground">
          Preview mode — not yet connected
        </p>
        <p className="mt-0.5 text-muted-foreground">
          Waiting on: {missing.join(", ")}. Sign-in and saved data are disabled
          until these are configured. Everything you see is a working shell.
        </p>
      </div>
    </div>
  );
}
