"use client";

import * as React from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { markdownExtensions } from "./extensions";
import { cn } from "../../lib/utils";

// MarkdownView — read-only renderer for a bulletin body (the standalone bulletin
// page + compose preview). react-markdown is NOT in the dependency tree, so per
// the slice brief this renders via Tiptap instead: an editable:false editor with
// the same schema-constrained extensions. That schema IS the sanitiser — the
// rendered HTML can only contain the nodes/marks the extensions define, and
// `html: false` in the markdown parser keeps raw/script HTML out. Client-only
// (Tiptap uses the DOM).

const PROSE_CLASS =
  "prose-view max-w-none text-sm leading-relaxed " +
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold " +
  "[&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold " +
  "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_strong]:font-semibold";

export interface MarkdownViewProps {
  /** Bulletin body as a markdown string. */
  value: string;
  className?: string;
}

export function MarkdownView({ value, className }: MarkdownViewProps) {
  const editor = useEditor({
    extensions: markdownExtensions,
    content: value,
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: cn(PROSE_CLASS, className) } },
  });

  // Re-render when the source markdown changes.
  React.useEffect(() => {
    if (editor) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  return <EditorContent editor={editor} />;
}
