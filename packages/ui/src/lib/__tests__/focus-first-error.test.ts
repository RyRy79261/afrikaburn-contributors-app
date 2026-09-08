import { describe, expect, it, vi, afterEach } from "vitest";
import { focusFirstError } from "../focus-first-error";

// REGRESSION TEST FOR A DEAD SUBMIT BUTTON. The Burner Bio refused a malformed
// username by setting an error on a field at the top of a step several screens
// long and returning — so pressing "Save & continue" at the bottom changed
// nothing the person could see. These cases pin the behaviour that fixes it:
// the refused field is scrolled to and focused, and nothing else is.

/** Mount inputs by id, each with its OWN scrollIntoView spy — a spy on the
 *  shared prototype is one spy for every element, so "the other field was not
 *  scrolled to" could not be asserted through it.
 *
 *  Returns an accessor rather than a record so a typo in an id fails loudly
 *  here instead of surfacing as an assertion about `undefined`. */
function mount(ids: string[]): (id: string) => HTMLInputElement {
  document.body.innerHTML = "";
  for (const id of ids) {
    const input = document.createElement("input");
    input.id = id;
    input.scrollIntoView = vi.fn();
    document.body.appendChild(input);
  }
  return (id) => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) {
      throw new Error(`test setup: no input mounted with id "${id}"`);
    }
    return el;
  };
}

describe("focusFirstError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("scrolls to and focuses the field that was refused", () => {
    const field = mount(["username", "homeCity"]);
    const username = field("username");

    focusFirstError({ username: "Usernames can't have spaces." }, { defer: false });

    expect(document.activeElement).toBe(username);
    expect(username.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("centres the field rather than merely revealing it", () => {
    // `block: "center"` is the difference between the message sitting one pixel
    // inside the viewport edge and sitting where someone is looking.
    const field = mount(["username"]);
    const username = field("username");

    focusFirstError({ username: "nope" }, { defer: false });

    expect(username.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("takes the FIRST refused field, not an arbitrary one", () => {
    const field = mount(["username", "homeCity"]);
    const username = field("username");
    const homeCity = field("homeCity");

    focusFirstError(
      { username: "first", homeCity: "second" },
      { defer: false },
    );

    expect(document.activeElement).toBe(username);
    expect(homeCity.scrollIntoView).not.toHaveBeenCalled();
  });

  it("skips keys that are not on screen and takes the next that is", () => {
    // A server rejection can name a field belonging to a step the person is not
    // looking at. Skipping to the next RENDERED field beats doing nothing.
    const field = mount(["homeCity"]);
    const homeCity = field("homeCity");

    focusFirstError(
      { onAnotherStep: "not rendered", homeCity: "rendered" },
      { defer: false },
    );

    expect(document.activeElement).toBe(homeCity);
  });

  it("ignores form-level keys, which already render beside the button", () => {
    const field = mount(["username"]);
    const username = field("username");

    focusFirstError(
      { _form: "We couldn't save just now.", username: "bad handle" },
      { ignore: ["_form"], defer: false },
    );

    expect(document.activeElement).toBe(username);
  });

  it("does nothing when there is no error", () => {
    const field = mount(["username"]);
    const username = field("username");

    focusFirstError({}, { defer: false });

    expect(document.activeElement).not.toBe(username);
    expect(username.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when no refused field is rendered", () => {
    mount(["username"]);

    expect(() =>
      focusFirstError({ missing: "nothing to focus" }, { defer: false }),
    ).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it("defers to the next frame by default, so React has painted the error", () => {
    const field = mount(["username"]);
    const username = field("username");
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      }) as never);

    focusFirstError({ username: "bad" });

    expect(raf).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(username);
  });

  it("does not scroll a second time when focusing", () => {
    // focus({preventScroll:true}) matters: without it the browser scrolls again
    // on its own terms and undoes the centring.
    const field = mount(["username"]);
    const username = field("username");
    const focus = vi.spyOn(username, "focus");

    focusFirstError({ username: "bad" }, { defer: false });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
