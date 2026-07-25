import { Info } from "lucide-react";
import type { ContentBlock } from "@quagga/types";

// Builder v2 content blocks (questionnaire-spec §"Content & structure blocks").
// These take NO answer: they never appear in the response map, never count
// towards progress, and never gate completion — `pageQuestions()` /
// `visibleQuestions()` filter them out upstream, so this component is purely
// decorative by construction.

export function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.kind === "info_block") {
    return (
      <div className="flex gap-3 rounded-md border border-border bg-muted/40 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          {block.heading && (
            <p className="text-sm font-semibold">{block.heading}</p>
          )}
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {block.body}
          </p>
        </div>
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-1.5">
      {/* Author-supplied remote URL: next/image would need host allowlisting we
          deliberately don't configure (no blob infrastructure yet). */}
      <img
        src={block.url}
        alt={block.alt}
        loading="lazy"
        className="w-full rounded-md border border-border object-cover"
      />
      {block.caption && (
        <figcaption className="text-xs text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
