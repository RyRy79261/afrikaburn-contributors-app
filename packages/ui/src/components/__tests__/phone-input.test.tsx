import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PhoneInput } from "../phone-input";

// Phone is a HARD-LOCKED private field (@quagga/core `privacy.ts`): never
// publicly exposable, with no reveal path of any kind. This component is where
// it is captured, so the contract that matters is the one about the VALUE it
// hands back — always a string, "" when cleared, never undefined or null. A
// consumer that stored `undefined` would write a column it did not mean to.
//
// MEASURED, NOT ASSUMED. Every literal below is a string this component
// actually produced under jsdom, including the two that are surprising.

function renderPhone(
  over: Partial<React.ComponentProps<typeof PhoneInput>> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <PhoneInput value="" onChange={onChange} id="phone" {...over} />,
  );
  const field = view.container.querySelector(
    'input[type="tel"]',
  ) as HTMLInputElement;
  return { ...view, onChange, field };
}

/** Type into the field one character at a time, the way a person does. */
function type(field: HTMLInputElement, text: string) {
  for (const ch of text) {
    fireEvent.change(field, { target: { value: field.value + ch } });
  }
}

describe("the value contract", () => {
  it("seeds the field with the country's calling code, not an empty box", () => {
    const { field } = renderPhone();
    // `international` mode: the number is always shown in +CC form, so the
    // field opens already knowing which country it is adding to.
    expect(field.value).toBe("+27");
  });

  it("emits the EMPTY STRING when the field is cleared, never undefined", () => {
    const { field, onChange } = renderPhone({ value: "+27821234567" });
    expect(field.value).toBe("+27 82 123 4567");

    fireEvent.change(field, { target: { value: "" } });
    // `v ?? ""` is the whole contract. A consumer writing `undefined` into a
    // hard-locked column is a data defect nothing downstream would catch.
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(onChange.mock.calls.every(([v]) => typeof v === "string")).toBe(
      true,
    );
  });

  it("renders a stored E.164 number back in readable international form", () => {
    const { field } = renderPhone({ value: "+27821234567" });
    // Stored as E.164, shown grouped — the same number a person reads off
    // their own handset.
    expect(field.value).toBe("+27 82 123 4567");
  });

  it("emits E.164 as a South African number is typed, trunk zero and all", () => {
    const { field, onChange } = renderPhone();
    // "082 123 4567" is how South Africans write and say their own number.
    type(field, "0821234567");

    expect(field.value).toBe("+27 082 123 4567");
    // The leading 0 is dropped from the emitted value character by character —
    // this is the string that reaches the column.
    expect(onChange).toHaveBeenLastCalledWith("+27821234567");
  });

  it("emits E.164 for a number typed without the trunk zero", () => {
    const { field, onChange } = renderPhone();
    type(field, "821234567");
    expect(onChange).toHaveBeenLastCalledWith("+27821234567");
  });

  it("MEASURED: replacing the whole field wholesale keeps whatever was pasted", () => {
    const { field, onChange } = renderPhone();
    // Select-all-and-paste, which wipes the "+27" the field opened with.
    fireEvent.change(field, { target: { value: "0821234567" } });

    // Observed, not assumed: the library reads the pasted string as already
    // international and emits "+0821234567" — eleven digits behind a "+0",
    // which is not a valid number anywhere. Typing the same digits (the case
    // above) is correct, so this is a paste-shaped input only. Recorded here so
    // the behaviour is visible; raised as a finding rather than endorsed, and
    // the server-side check is what must refuse it.
    expect(onChange).toHaveBeenLastCalledWith("+0821234567");
  });
});

describe("the country picker", () => {
  it("defaults to South Africa and names itself for a screen reader", () => {
    renderPhone();
    const trigger = screen.getByRole("combobox", { name: "Country" });
    // Icon-only (a flag), so the accessible name is all a screen reader has.
    expect(trigger).toBeDefined();
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("honours an overridden default country", () => {
    const { field } = renderPhone({ defaultCountry: "NA" });
    // Namibia is +264. Ignoring defaultCountry would silently file a Namibian
    // supplier's number as a South African one.
    expect(field.value).toBe("+264");
  });

  it("disables both halves together", () => {
    const { field } = renderPhone({ disabled: true });
    expect(field.disabled).toBe(true);
    // A disabled number field beside a live country picker invites someone to
    // change a country they cannot then use.
    expect(
      (screen.getByRole("combobox", { name: "Country" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("wiring", () => {
  it("threads the id and describedBy onto the field itself", () => {
    const { field } = renderPhone({ describedBy: "phone-help" });
    // The <Field> wrapper points its label at this id and its help text at
    // describedBy; on the wrong element both are silently useless.
    expect(field.id).toBe("phone");
    expect(field.getAttribute("aria-describedby")).toBe("phone-help");
  });

  it("takes the caller's placeholder", () => {
    const { field } = renderPhone({ placeholder: "Mobile number" });
    expect(field.getAttribute("placeholder")).toBe("Mobile number");
  });
});
