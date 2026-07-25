import { AlertTriangle, Circle } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";

// Blocking status must be explicit EVERYWHERE a questionnaire is shown
// (questionnaire-spec §"Engine mechanics", Ryan 24 Jul): a required one is a
// hard gate; an optional one never impedes navigation. This one badge is reused
// on pending cards, list rows, the fill page, and the author's views so the
// treatment is identical across every surface.
export function BlockingBadge({
  blocking,
  className,
}: {
  blocking: boolean;
  className?: string;
}) {
  if (blocking) {
    return (
      <Badge variant="destructive" className={className}>
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Required · blocks until done
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={className}>
      <Circle className="h-3 w-3" aria-hidden />
      Optional
    </Badge>
  );
}
