import { Editor } from "@tiptap/core";
import { markdownExtensions } from "./extensions";

// Headless markdown helpers — no React. Used by the round-trip tests and any
// place that needs a markdown ⇄ HTML conversion off the React tree. Each call
// spins up a detached Tiptap editor (requires a DOM: jsdom in tests, the browser
// at runtime) and tears it down, so it is intentionally not for hot server-side
// paths — MarkdownView renders on the client via useEditor instead.

interface MarkdownStorage {
  getMarkdown(): string;
}

function withEditor<T>(markdown: string, read: (editor: Editor) => T): T {
  const editor = new Editor({
    extensions: markdownExtensions,
    content: markdown,
  });
  try {
    return read(editor);
  } finally {
    editor.destroy();
  }
}

/** Parse markdown → schema-constrained HTML (safe: only known nodes/marks). */
export function markdownToHtml(markdown: string): string {
  return withEditor(markdown, (editor) => editor.getHTML());
}

/** Normalise markdown by parsing then re-serialising through the schema. */
export function roundTripMarkdown(markdown: string): string {
  return withEditor(markdown, (editor) =>
    (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown(),
  );
}
