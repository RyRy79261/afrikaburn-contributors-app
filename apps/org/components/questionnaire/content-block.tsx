import { Info, PlayCircle } from "lucide-react";
import type { ContentBlock } from "@quagga/types";

// Builder v2 content blocks (questionnaire-spec §"Content & structure blocks").
// These take NO answer: they never appear in the response map, never count
// towards progress, and never gate completion — `pageQuestions()` /
// `visibleQuestions()` filter them out upstream, so this component is purely
// decorative by construction.
//
// Lifted out of questionnaire-preview.tsx so the console GATE renders the same
// info panels and images the author previewed. It previously rendered neither:
// the gate walked `pageQuestions()`, which drops content blocks, so the "read
// this before you answer" panel an author had written was silently missing from
// the one screen that blocks the whole console.

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

  if (block.kind === "video_link") {
    // A video LINK card (camp onboarding). The console's palette doesn't offer
    // it; rendered as a plain external link if one is ever shown here — never
    // an embed.
    return (
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm underline-offset-4 hover:underline"
      >
        <PlayCircle className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        {block.title}
      </a>
    );
  }

  return (
    <figure className="flex flex-col gap-1.5">
      {/* Author-supplied remote URL — no host allowlisting configured. */}
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
