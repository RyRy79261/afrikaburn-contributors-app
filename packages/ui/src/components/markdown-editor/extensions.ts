import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { Extensions } from "@tiptap/core";

// Shared Tiptap extension set for the bulletin-compose editor and the read-only
// MarkdownView. Vendored per docs/platform-architecture-spec.md ("Markdown
// editor decision": minimal-tiptap-style, tiptap-markdown for markdown in/out,
// React 19-compatible). Kept deliberately minimal to the bulletin needs:
// headings, bold, italic, links, bullet/ordered lists (StarterKit bundles all
// of these in v3).
//
// Safety: `html: false` makes tiptap-markdown treat raw HTML in the markdown as
// plain text rather than parsing it, and the ProseMirror schema below is the
// sanitiser — generated HTML can only contain nodes/marks this schema defines,
// so there is no path for arbitrary/script HTML to render. Links are restricted
// to safe protocols.

export const markdownExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    },
  }),
  Markdown.configure({
    html: false,
    linkify: true,
    breaks: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
];
