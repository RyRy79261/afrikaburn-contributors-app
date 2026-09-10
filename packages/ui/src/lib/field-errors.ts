// Field-error plumbing for a form where ONE `Field` can own more than one
// control — an emergency contact's name and phone, an ID's type and number.
//
// WHY THIS IS A MODULE AND NOT TWO CLOSURES IN THE COMPONENT. It was two
// closures in the component, and a regression gutted one of them to
// `ids.map((id) => id).filter(() => false)` — always empty, so every inline
// refusal silently stopped rendering. It shipped. The unit tests around it were
// SOURCE assertions (the component lives outside the vitest include path), and
// they still passed: they checked that a `fieldError(...)` call and a
// `found.join(" · ")` existed, which both still did. Only the persona suite
// caught it, on the one field it happens to type into.
//
// Source assertions can prove a call is WIRED UP. They cannot prove it
// COMPUTES anything. So the computing part lives here, next to `focusFirstError`
// for the same reason that one did, and has tests that run it.

/**
 * The message a `Field` should display, given the answer keys it owns.
 *
 * Returns `undefined` when none of `ids` was refused, so it drops straight into
 * `<Field error={…}>`. When several halves of one field were refused it joins
 * them rather than picking the first — "Enter a valid phone number" alone,
 * shown against a field whose NAME was also rejected, sends the person to fix
 * the wrong half.
 */
export function fieldErrorFor(
  errors: Record<string, string>,
  ...ids: string[]
): string | undefined {
  const found = ids.map((id) => errors[id]).filter(Boolean);
  return found.length > 0 ? found.join(" · ") : undefined;
}

/**
 * The id of the element describing a control that SHARES a `Field`.
 *
 * `Field` derives its message id from its own `htmlFor` — `${htmlFor}-error`
 * when refused, `${htmlFor}-help` otherwise. A second control in the same Field
 * therefore cannot describe itself as `${itsOwnKey}-error`: nothing renders
 * that id, and pointing `aria-describedby` at a missing element is worse than
 * pointing at nothing, because a screen reader announces neither the help nor
 * the error.
 *
 * So this keys on the FIELD and asks whether any of the answers it owns were
 * refused.
 */
export function describedByForGroup(
  errors: Record<string, string>,
  fieldId: string,
  ...keys: string[]
): string {
  return keys.some((k) => errors[k]) ? `${fieldId}-error` : `${fieldId}-help`;
}
