import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "../badge";
import { PaymentDetailsBlock } from "../payment-details-block";
import { DisabledHintTile } from "../disabled-hint-tile";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Accepting members</Badge>);
    expect(screen.getByText("Accepting members")).toBeDefined();
  });
});

describe("PaymentDetailsBlock", () => {
  it("shows the reference, formatted amount, and status", () => {
    render(
      <PaymentDetailsBlock
        reference="QP-2027-MAH-001"
        amountCents={25000}
        status="pending"
        subjectLabel="Placement fee"
      />,
    );
    expect(screen.getByText("QP-2027-MAH-001")).toBeDefined();
    expect(screen.getByText("Awaiting payment")).toBeDefined();
    expect(screen.getByText("Placement fee")).toBeDefined();
  });

  it("falls back to 'To be confirmed' when no amount is set", () => {
    render(<PaymentDetailsBlock reference="QP-2027-C40-002" status="waived" />);
    expect(screen.getByText("To be confirmed")).toBeDefined();
    expect(screen.getByText("Waived")).toBeDefined();
  });
});

describe("DisabledHintTile", () => {
  it("names the parked capability and its reason", () => {
    render(
      <DisabledHintTile
        title="Containers"
        hint="Separate app — for large camps"
        tag="Separate app"
      />,
    );
    expect(screen.getByText("Containers")).toBeDefined();
    expect(screen.getByText("Separate app — for large camps")).toBeDefined();
  });
});
