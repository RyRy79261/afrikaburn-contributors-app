import { AlertTriangle, Circle } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";

/**
 * The explicit blocking-status badge required on EVERY questionnaire surface
 * (questionnaire-spec, Ryan 24 Jul): a blocking questionnaire is a hard gate, so
 * it always carries a destructive/warning "Required — blocks the app until done"
 * badge, and non-blocking ones a muted "Optional". Never render a questionnaire
 * without one of these.
 */
export function BlockingBadge({ blocking }: { blocking: boolean }) {
  if (blocking) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Required — blocks the app until done
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Circle className="h-3 w-3" aria-hidden />
      Optional
    </Badge>
  );
}
