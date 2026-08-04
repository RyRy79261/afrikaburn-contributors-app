import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FileUpload } from "../file-upload";
import { Toaster, toast } from "../toast";

// FileUpload is the client-side gate in front of every image and document in
// the product. The server route re-enforces type and size on the issued token,
// so this pre-check is not the security boundary — but it is the ONLY thing
// that explains a refusal to the person holding the file, and it is the only
// thing that keeps a 40 MB photo off a mobile connection at all.
//
// Every refusal below is asserted through a real rendered <Toaster/> rather
// than a spy on `toast`, because "we called toast.error" and "the user was told
// something" are different claims and only the second one matters.

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: uploadMock }));

type Props = Partial<React.ComponentProps<typeof FileUpload>>;

function renderUpload(props: Props = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const view = render(
    <>
      <FileUpload
        value={[]}
        onChange={onChange}
        handleUploadUrl="/api/blob"
        blobConfigured
        kind="bulletin"
        {...props}
      />
      <Toaster />
    </>,
  );
  return { ...view, onChange, onCommit };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!el) throw new Error("no file input rendered");
  return el as HTMLInputElement;
}

/** A File of an exact byte length, so the size cap can be probed precisely. */
function fileOfSize(bytes: number, name = "photo.png", type = "image/png") {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  // The toast store is module-level; a leaked toast would let a later
  // assertion pass on an earlier test's message. Reset BEFORE the render, so
  // nothing mutates the store while a <Toaster/> is still mounted.
  toast.dismiss();
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({ url: "https://blob.example/uploaded.png" });
});



describe("honest degradation when Blob is not configured", () => {
  it("offers a URL field and says why, instead of a dropzone that does nothing", () => {
    const { container } = renderUpload({ blobConfigured: false });

    expect(
      screen.getByText(/uploads aren't configured on this deployment/i),
    ).toBeDefined();
    expect(screen.getByLabelText("Paste a URL")).toBeDefined();
    // A dropzone here would accept a drop and silently discard it.
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("keeps the URL field even when paste is disallowed, since it is the only route left", () => {
    renderUpload({ blobConfigured: false, allowUrlPaste: false });
    expect(screen.getByLabelText("Paste a URL")).toBeDefined();
  });
});

describe("adding a URL by hand", () => {
  it("refuses a string that is not a URL and stores nothing", async () => {
    const { onChange } = renderUpload();
    fireEvent.change(screen.getByLabelText("Paste a URL"), {
      target: { value: "not a link" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("That doesn't look like a valid URL."))
      .toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a duplicate rather than storing the same URL twice", async () => {
    const url = "https://example.com/a.png";
    const { onChange } = renderUpload({ value: [url], maxFiles: 3 });
    fireEvent.change(screen.getByLabelText("Paste a URL"), {
      target: { value: url },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("That link is already added.")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores an empty draft without complaining about it", () => {
    const { onChange } = renderUpload();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("appends a valid URL, clears the draft, and commits for autosave", async () => {
    const onCommit = vi.fn();
    const { onChange } = renderUpload({
      value: ["https://example.com/first.png"],
      maxFiles: 2,
      onCommit,
    });
    const field = screen.getByLabelText("Paste a URL") as HTMLInputElement;
    fireEvent.change(field, {
      target: { value: "https://example.com/second.png" },
    });
    // Enter is the natural way to finish a pasted link.
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith([
      "https://example.com/first.png",
      "https://example.com/second.png",
    ]);
    expect(field.value).toBe("");
    // onCommit runs a tick later, once React has flushed the new value —
    // an autosave that read it synchronously would save the OLD list.
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
  });
});

describe("validate", () => {
  it("names the accepted image formats when the type is wrong", async () => {
    const { container, onChange } = renderUpload({ variant: "image" });
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10, "notes.pdf", "application/pdf")] },
    });

    expect(
      await screen.findByText("Upload a PNG, JPEG, WebP, or GIF image."),
    ).toBeDefined();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the generic wording for the file variant, which has no fixed set", async () => {
    const { container } = renderUpload({
      variant: "file",
      acceptedTypes: ["application/pdf"],
    });
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10, "photo.png", "image/png")] },
    });

    expect(await screen.findByText("That file type isn't allowed here."))
      .toBeDefined();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it.each([
    [8 * 1024 * 1024, "That file is larger than 8 MB."],
    [512 * 1024, "That file is larger than 512 KB."],
    [500, "That file is larger than 500 B."],
  ])("reports the cap in readable units (%i bytes)", async (cap, message) => {
    const { container } = renderUpload({ maxSizeBytes: cap });
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(cap + 1)] },
    });

    expect(await screen.findByText(message)).toBeDefined();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("uploading", () => {
  it("stores the URL the blob service returned", async () => {
    const { container, onChange } = renderUpload();
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10)] },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        "https://blob.example/uploaded.png",
      ]),
    );
    const [pathname, , opts] = uploadMock.mock.calls[0] as [
      string,
      File,
      { clientPayload: string; handleUploadUrl: string },
    ];
    // The kind organises the blob path AND tells the server route which policy
    // to put on the token it issues.
    expect(pathname).toBe("bulletin/photo.png");
    expect(opts.handleUploadUrl).toBe("/api/blob");
    expect(JSON.parse(opts.clientPayload)).toEqual({ kind: "bulletin" });
  });

  it("sanitises the filename it sends rather than trusting the local one", async () => {
    const { container } = renderUpload();
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10, "my holiday snap (1).png")] },
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock.mock.calls[0]![0]).toBe("bulletin/my-holiday-snap-1-.png");
  });

  it("surfaces the upload error's own message", async () => {
    uploadMock.mockRejectedValue(new Error("Token expired."));
    const { container, onChange } = renderUpload();
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10)] },
    });

    expect(await screen.findByText("Token expired.")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to actionable advice when the throw carries no message", async () => {
    uploadMock.mockRejectedValue("nope");
    const { container } = renderUpload();
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10)] },
    });

    // "Check your connection or paste a link instead" is the only sentence here
    // that tells someone what to DO about it.
    expect(
      await screen.findByText("Check your connection or paste a link instead."),
    ).toBeDefined();
  });

  it("shows live progress while a file is in flight", async () => {
    let release: ((v: { url: string }) => void) | undefined;
    uploadMock.mockImplementation(
      (_path: string, _file: File, opts: {
        onUploadProgress: (p: { percentage: number }) => void;
      }) => {
        opts.onUploadProgress({ percentage: 42 });
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    );
    const { container } = renderUpload();
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10)] },
    });

    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("Uploading… 42%")).toBeDefined();
    release?.({ url: "https://blob.example/uploaded.png" });
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });

  it("takes only what fits and says how much room was left", async () => {
    const { container, onChange } = renderUpload({ maxFiles: 2 });
    fireEvent.change(fileInput(container), {
      target: {
        files: [
          fileOfSize(10, "a.png"),
          fileOfSize(10, "b.png"),
          fileOfSize(10, "c.png"),
        ],
      },
    });

    expect(await screen.findByText("Only 2 more files fit here.")).toBeDefined();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("gets the singular right when there is room for exactly one more", async () => {
    const { container } = renderUpload({
      maxFiles: 2,
      value: ["https://example.com/a.png"],
    });
    fireEvent.change(fileInput(container), {
      target: { files: [fileOfSize(10, "b.png"), fileOfSize(10, "c.png")] },
    });

    // "Only 1 more files fit here" is the kind of thing nobody files a bug for
    // and everybody notices.
    expect(await screen.findByText("Only 1 more file fits here.")).toBeDefined();
  });

  it("uploads what was dropped on the dropzone", async () => {
    const { container, onChange } = renderUpload({ ariaLabel: "Add a photo" });
    const zone = screen.getByLabelText("Add a photo");
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [fileOfSize(10)] } });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        "https://blob.example/uploaded.png",
      ]),
    );
    expect(fileInput(container)).toBeDefined();
  });
});

describe("the cap and removal", () => {
  it("hides every add control once maxFiles is reached", () => {
    const { container } = renderUpload({
      value: ["https://example.com/a.png"],
      maxFiles: 1,
    });

    // Not merely disabled — an add control that can never succeed is a lie.
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByLabelText("Paste a URL")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("removes exactly the clicked image and keeps the rest", () => {
    const value = [
      "https://example.com/a.png",
      "https://example.com/b.png",
      "https://example.com/c.png",
    ];
    const { onChange } = renderUpload({ value, maxFiles: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Remove upload 2" }));

    expect(onChange).toHaveBeenCalledWith([
      "https://example.com/a.png",
      "https://example.com/c.png",
    ]);
  });

  it("names a document row by its filename, decoded", () => {
    const { onChange } = renderUpload({
      variant: "file",
      value: ["https://example.com/docs/Public%20Liability%20Cover.pdf"],
      maxFiles: 2,
    });

    // A percent-encoded name is what a browser produces from a real filename;
    // showing it raw makes the row unreadable.
    expect(screen.getByText("Public Liability Cover.pdf")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Public Liability Cover.pdf",
      }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("falls back to the raw string when a stored value is not a URL", () => {
    renderUpload({ variant: "file", value: ["legacy-local-path"], maxFiles: 2 });
    // Legacy rows exist; rendering nothing for them would hide a real document.
    expect(screen.getByText("legacy-local-path")).toBeDefined();
  });

  it("offers no remove control at all when the field is disabled", () => {
    renderUpload({
      value: ["https://example.com/a.png"],
      maxFiles: 2,
      disabled: true,
    });
    expect(screen.queryByRole("button", { name: "Remove upload 1" })).toBeNull();
  });
});
