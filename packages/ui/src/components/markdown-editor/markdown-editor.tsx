"use client";

import * as React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Bold,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
} from "lucide-react";
import { markdownExtensions } from "./extensions";
import { cn } from "../../lib/utils";

// MarkdownEditor — the minimal bulletin-compose editor (component-spec Tier 3;
// docs/platform-architecture-spec.md decision). Value in/out is a MARKDOWN
// STRING — `value` seeds the doc, `onChange` fires the serialised markdown on
// every edit. Toolbar is intentionally minimal: bold / italic / link / bullet
// list / ordered list / heading. Client-only (Tiptap uses the DOM).

const PROSE_CLASS =
  "prose-editor min-h-[8rem] max-w-none px-3 py-2 text-sm leading-relaxed focus:outline-none " +
  "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold " +
  "[&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold " +
  "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_strong]:font-semibold";

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, active, label, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-primary/15 text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = React.useCallback(() => {
    const previous = (editor.getAttributes("link").href as string) ?? "";
    const url = window.prompt("Link URL", previous);
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  return (
    <div className="flex items-center gap-0.5 border-b border-input px-1.5 py-1">
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Link"
        active={editor.isActive("link")}
        onClick={setLink}
      >
        <LinkIcon className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" aria-hidden />
      </ToolbarButton>
    </div>
  );
}

interface MarkdownStorage {
  getMarkdown(): string;
}

export interface MarkdownEditorProps {
  /** Current value as a markdown string. */
  value?: string;
  /** Fired with the serialised markdown on every edit. */
  onChange?: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  /** Accessible label for the editable region. */
  ariaLabel?: string;
}

export function MarkdownEditor({
  value = "",
  onChange,
  className,
  ariaLabel = "Bulletin body",
}: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: markdownExtensions,
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: PROSE_CLASS, "aria-label": ariaLabel },
    },
    onUpdate: ({ editor: e }) => {
      onChange?.(
        (e.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown(),
      );
    },
  });

  // Keep the editor in sync when `value` is changed from outside (controlled
  // resets), without clobbering the caret while the user is typing.
  React.useEffect(() => {
    if (!editor) return;
    const current = (
      editor.storage as unknown as { markdown: MarkdownStorage }
    ).markdown.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
