import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  registrationStatusVariant,
  REGISTRATION_STATUS_LABEL,
  StatusBadge,
} from "../status-badge";
import { Switch } from "../switch";
import { AckRow } from "../checkbox";
import { NotificationBell } from "../notification-bell";
import { Field } from "../field";
import { TextareaWithCount } from "../textarea-with-count";
import { PasswordInput } from "../password-input";

describe("registration status map", () => {
  it("maps every status to a base badge variant per spec", () => {
    expect(registrationStatusVariant("draft")).toBe("outline");
    expect(registrationStatusVariant("submitted")).toBe("default");
    expect(registrationStatusVariant("under_review")).toBe("default");
    expect(registrationStatusVariant("changes_requested")).toBe("warning");
    expect(registrationStatusVariant("approved")).toBe("success");
    expect(registrationStatusVariant("rejected")).toBe("destructive");
    expect(registrationStatusVariant("withdrawn")).toBe("secondary");
  });

  it("StatusBadge renders the human label", () => {
    render(<StatusBadge status="changes_requested" />);
    expect(
      screen.getByText(REGISTRATION_STATUS_LABEL.changes_requested),
    ).toBeDefined();
  });
});

describe("Switch privacy variant", () => {
  it("shows ON · PUBLIC when checked and toggles", () => {
    const onChange = vi.fn();
    render(
      <Switch
        variant="privacy"
        checked
        onCheckedChange={onChange}
        aria-label="Show bio publicly"
      />,
    );
    expect(screen.getByText("On · Public")).toBeDefined();
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows OFF · PRIVATE when unchecked", () => {
    render(<Switch variant="privacy" checked={false} aria-label="x" />);
    expect(screen.getByText("Off · Private")).toBeDefined();
  });

  it("hard-lock forces OFF, disables, and cannot toggle (Bio hard-lock law)", () => {
    const onChange = vi.fn();
    render(
      <Switch
        variant="privacy"
        checked
        hardLocked
        onCheckedChange={onChange}
        aria-label="Phone"
      />,
    );
    expect(screen.getByText("Always private")).toBeDefined();
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect((sw as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("AckRow", () => {
  it("wraps a checkbox in a ≥44px label and toggles via the row", () => {
    const onChange = vi.fn();
    render(
      <AckRow onChange={onChange}>I have read the supplier basics</AckRow>,
    );
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText("I have read the supplier basics")).toBeDefined();
  });
});

describe("NotificationBell", () => {
  it("hides the badge at 0 and announces unread count", () => {
    const { rerender } = render(<NotificationBell count={0} />);
    expect(
      screen.getByRole("button", { name: "Notifications, none unread" }),
    ).toBeDefined();
    rerender(<NotificationBell count={3} />);
    expect(
      screen.getByRole("button", { name: "Notifications, 3 unread" }),
    ).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("caps the displayed number at max", () => {
    render(<NotificationBell count={250} max={99} />);
    expect(screen.getByText("99+")).toBeDefined();
  });
});

describe("Field", () => {
  it("shows error in place of help and links the label", () => {
    render(
      <Field label="Camp name" htmlFor="camp" help="Public" error="Required">
        <input id="camp" />
      </Field>,
    );
    expect(screen.getByText("Required")).toBeDefined();
    expect(screen.queryByText("Public")).toBeNull();
  });
});

describe("TextareaWithCount", () => {
  it("derives 'n / max words' and warns past the cap", () => {
    render(<TextareaWithCount maxWords={3} defaultValue="a b c d" />);
    const counter = screen.getByText("4 / 3 words");
    expect(counter).toBeDefined();
    expect(counter.className).toContain("text-destructive");
  });
});

describe("PasswordInput", () => {
  it("toggles visibility and shows length feedback below the minimum", () => {
    render(<PasswordInput id="pw" defaultValue="tooshort" />);
    const toggle = screen.getByRole("button", { name: "Show password" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeDefined();
    expect(screen.getByText(/at least 15 characters/)).toBeDefined();
  });
});
