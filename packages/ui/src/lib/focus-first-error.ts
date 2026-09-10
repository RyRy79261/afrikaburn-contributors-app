/**
 * Put the viewport and the keyboard on the first field a form refused.
 *
 * WITHOUT THIS A SUBMIT BUTTON READS AS DEAD, at every screen size. A long form
 * puts its fields at the top and its submit at the bottom, so a validator that
 * sets an error and returns changes the page several hundred pixels above where
 * the person is looking: the page sits still, nothing near the button moves,
 * and the honest reading is that the button is broken. Measured on the Burner
 * Bio at 1280x800, the refusal rendered 615px above the top of the viewport.
 *
 * Focus rather than scroll alone: it lands the caret in the field that has to
 * change, and a control wired to its error text through `aria-describedby` —
 * which `Field` does — has the reason read out on arrival.
 *
 * THE ERROR KEYS MUST BE THE CONTROL IDS. That is `Field`'s wiring contract
 * (the same `htmlFor` is the control's `id`), and it is what makes the lookup
 * possible. Keys with no element in the document are skipped rather than
 * guessed at, so an error belonging to a step that is not currently rendered
 * costs nothing.
 */
export interface FocusFirstErrorOptions {
  /**
   * Keys that are NOT control ids — form-level errors that already render
   * beside the submit button and so need no scroll. Defaults to none.
   */
  ignore?: readonly string[];
  /**
   * Defer to the next frame so React has committed the error text before the
   * scroll is measured — the text is what changes the field's height. Pass
   * false to act synchronously, which is what a test wants.
   */
  defer?: boolean;
}

export function focusFirstError(
  errors: Record<string, string>,
  options: FocusFirstErrorOptions = {},
): void {
  const { ignore = [], defer = true } = options;
  if (typeof document === "undefined") return;

  const act = () => {
    // Insertion order. The first key a validator sets is the field the person
    // should be taken to; `find` skips any key whose control is not rendered.
    const target = Object.keys(errors)
      .filter((key) => !ignore.includes(key))
      .map((key) => document.getElementById(key))
      .find((el): el is HTMLElement => el instanceof HTMLElement);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  };

  if (defer && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(act);
    return;
  }
  act();
}
