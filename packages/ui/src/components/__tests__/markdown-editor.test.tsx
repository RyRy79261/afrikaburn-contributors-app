import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { MarkdownEditor } from "../markdown-editor/markdown-editor";
import { MarkdownView } from "../markdown-editor/markdown-view";

// The editor's own comment records an accessibility gap found only because an
// e2e spec could not find the region by role: a bare `contenteditable` div
// announces as a generic GROUP, so assistive technology is told there is
// something here but not that it can be typed into. `role=textbox` +
// `aria-multiline` are set explicitly, and that is exactly the kind of
// attribute a refactor drops without anything failing.
//
// The other load-bearing behaviour is the external-reset guard: seeding the
// document from a changed `value` must NOT emit an update, or a controlled
// parent that autosaves on change loops against itself.

// jsdom implements no layout, so neither a Range nor a Text node has
// `getClientRects` / `getBoundingClientRect`. ProseMirror asks for them when a command
// scrolls the selection into view, and the resulting TypeError is thrown
// ASYNCHRONOUSLY — it reddens the run rather than any single test. Nothing below
// asserts on geometry; these exist only so the scroll can be a no-op.
const EMPTY_RECT = {
  top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
for (const proto of [Range.prototype, Text.prototype]) {
  if (!("getClientRects" in proto)) {
    Object.defineProperties(proto, {
      getClientRects: {
        value: () => [] as unknown as DOMRectList,
        writable: true,
        configurable: true,
      },
      getBoundingClientRect: {
        value: () => EMPTY_RECT,
        writable: true,
        configurable: true,
      },
    });
  }
}

async function findEditable(): Promise<HTMLElement> {
  return await screen.findByRole("textbox");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the editable region", () => {
  it("announces as multi-line edit text with the caller's label", async () => {
    render(<MarkdownEditor value="Hello" ariaLabel="Camp description" />);
    const region = await findEditable();

    expect(region.getAttribute("aria-multiline")).toBe("true");
    expect(region.getAttribute("aria-label")).toBe("Camp description");
    expect(region.getAttribute("contenteditable")).toBe("true");
  });

  it("defaults its label to the bulletin body it was built for", async () => {
    render(<MarkdownEditor value="Hello" />);
    expect((await findEditable()).getAttribute("aria-label")).toBe(
      "Bulletin body",
    );
  });

  it("renders the seeded markdown as real structure, not as text", async () => {
    render(<MarkdownEditor value={"## Gate times\n\n- Open at 09:00"} />);
    const region = await findEditable();

    expect(region.querySelector("h2")?.textContent).toBe("Gate times");
    expect(region.querySelector("ul li")?.textContent).toBe("Open at 09:00");
  });
});

describe("the toolbar", () => {
  it("appears only once the editor exists, with a name on every control", async () => {
    render(<MarkdownEditor value="Hello" />);
    await findEditable();

    // Icon-only buttons: the label IS the control for anyone not looking at it.
    for (const label of [
      "Bold",
      "Italic",
      "Heading",
      "Link",
      "Bullet list",
      "Numbered list",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("reports what the caret is standing in through aria-pressed", async () => {
    const { unmount } = render(<MarkdownEditor value="Gate opens at nine" />);
    await findEditable();
    // aria-pressed is what tells a screen-reader user whether pressing this
    // would turn the heading ON or OFF. The attribute missing entirely would
    // leave them guessing.
    expect(
      screen.getByRole("button", { name: "Heading" }).getAttribute("aria-pressed"),
    ).toBe("false");
    unmount();

    render(<MarkdownEditor value={"## Gate times"} />);
    await findEditable();
    expect(
      screen.getByRole("button", { name: "Heading" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  // KNOWN GAP, measured not assumed: the toolbar does NOT repaint on a
  // transaction. `useEditor` in @tiptap/react 3.29 only re-renders on every
  // transaction when `shouldRerenderOnTransaction: true` is passed, and this
  // editor does not pass it (react/dist/index.js:519 — undefined behaves as
  // false). So typing inside bold text leaves the Bold button un-pressed until
  // something else re-renders the component. Asserting the stale value here
  // would pin the defect in place, so this test asserts the mount-time truth
  // only and the gap is reported instead.

  it("emits MARKDOWN, not HTML, when a mark is toggled", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="Gate opens at nine" onChange={onChange} />);
    await findEditable();

    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = onChange.mock.calls.at(-1)![0] as string;
    // The stored value is a markdown string everywhere in the product; a
    // consumer that got HTML would persist it and render it back as text.
    expect(emitted).toContain("## Gate opens at nine");
    expect(emitted).not.toContain("<h2>");
  });
});

describe("the link button", () => {
  it("changes nothing when the prompt is cancelled", async () => {
    const onChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<MarkdownEditor value="Read the guide" onChange={onChange} />);
    await findEditable();

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    // Cancel means cancel — not "unset the link", which is what an empty-string
    // check alone would do.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes the link when the prompt is emptied", async () => {
    const onChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("");
    render(
      <MarkdownEditor
        value="[Read the guide](https://afrikaburn.org)"
        onChange={onChange}
      />,
    );
    await findEditable();

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    // Clearing the field is the ONLY way to take a link off from this toolbar;
    // if it fell through to setLink instead, the author would be stuck with it.
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).not.toContain(
      "(https://afrikaburn.org)",
    );
  });
});

// NOT TESTED HERE, deliberately: SETTING a link over a selection. It needs a
// real text selection inside ProseMirror, which needs real layout — jsdom
// reports zero for every box, so any selection built here is fiction. The e2e
// suite drives a browser and owns that one.

describe("an external value change", () => {
  it("reseeds the document WITHOUT emitting an update", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor value="First draft" onChange={onChange} />,
    );
    await findEditable();
    onChange.mockClear();

    rerender(<MarkdownEditor value="Second draft" onChange={onChange} />);

    await waitFor(() =>
      expect((screen.getByRole("textbox").textContent ?? "")).toContain(
        "Second draft",
      ),
    );
    // This guard is what stops an autosave loop: parent saves → parent re-renders
    // with the saved value → editor emits → parent saves again.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MarkdownView", () => {
  it("renders the markdown read-only, with no textbox to type into", async () => {
    const { container } = render(
      <MarkdownView value={"## Gate times\n\nOpen at 09:00"} />,
    );

    await waitFor(() =>
      expect(container.querySelector("h2")?.textContent).toBe("Gate times"),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      container.querySelector("[contenteditable='true']"),
    ).toBeNull();
  });

  it("re-renders when the source markdown changes", async () => {
    const { container, rerender } = render(<MarkdownView value="Before" />);
    await waitFor(() =>
      expect(container.textContent).toContain("Before"),
    );

    rerender(<MarkdownView value="After" />);
    await waitFor(() => expect(container.textContent).toContain("After"));
    expect(container.textContent).not.toContain("Before");
  });

  it("SAFETY: raw HTML in the markdown is text, never markup", async () => {
    const { container } = render(
      <MarkdownView value={'Hello <img src=x onerror="alert(1)"> there'} />,
    );

    // `html: false` in the markdown parser plus the schema-constrained
    // extensions are the sanitiser. A rendered <img> here would mean bulletin
    // bodies — author-supplied text — can inject markup.
    await waitFor(() => expect(container.textContent).toContain("Hello"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("onerror");
  });
});
