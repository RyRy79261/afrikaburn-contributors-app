import { ExternalLink, Info, PlayCircle } from "lucide-react";
import type { ContentBlock } from "@quagga/types";

// Builder v2 content blocks (questionnaire-spec §"Content & structure blocks").
// These take NO answer: they never appear in the response map, never count
// towards progress, and never gate completion — `pageQuestions()` /
// `visibleQuestions()` filter them out upstream, so this component is purely
// decorative by construction.

/** The host a link points at, for the card's second line ("youtube.com"). */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

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
    // A LINK CARD, never an embed (ONBOARD-016): no iframe, no thumbnail
    // fetch, nothing loaded from the video host until the person chooses to
    // open it — which also means nothing about them reaches that host first.
    const host = linkHost(block.url);
    return (
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background">
          <PlayCircle className="h-5 w-5 text-accent" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Video link
          </span>
          <span className="truncate text-sm font-medium">{block.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {host ? `${host} · ` : ""}opens in a new tab
          </span>
        </span>
        <ExternalLink
          className="ml-auto h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </a>
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
