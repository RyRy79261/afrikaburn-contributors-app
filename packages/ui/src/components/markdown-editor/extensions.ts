import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { Extensions } from "@tiptap/core";

// Shared Tiptap extension set for the bulletin-compose editor and the read-only
// MarkdownView. Vendored ("Markdown
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

/** The extension set, with or without StarterKit's trailing empty paragraph. */
function buildMarkdownExtensions(trailingNode: boolean): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      },
      // The editor keeps a paragraph after a closing list so the cursor can
      // leave it; a read-only view has no cursor, and that empty paragraph
      // only shows as blank space under the text.
      ...(trailingNode ? {} : { trailingNode: false as const }),
    }),
    Markdown.configure({
      html: false,
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}

/** The editor's extensions. */
export const markdownExtensions: Extensions = buildMarkdownExtensions(true);

/** The read-only view's extensions: the same schema, no trailing paragraph. */
export const markdownViewExtensions: Extensions =
  buildMarkdownExtensions(false);
