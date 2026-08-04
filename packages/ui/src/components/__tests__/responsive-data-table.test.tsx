import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  ResponsiveDataTable,
  projectColumnsToCard,
  type ResponsiveColumn,
} from "../responsive-data-table";

interface Row {
  id: string;
  name: string;
  status: string;
  sound: string;
  submitted: string;
}

const rows: Row[] = [
  {
    id: "mah",
    name: "Mad Hatters",
    status: "Registered",
    sound: "Medium",
    submitted: "12 Feb 2027",
  },
  {
    id: "c404",
    name: "Camp 404",
    status: "Under review",
    sound: "Quiet",
    submitted: "Not submitted",
  },
];

const columns: ResponsiveColumn<Row>[] = [
  { id: "name", header: "Camp", role: "title", cell: (r) => r.name },
  { id: "status", header: "Status", role: "badge", cell: (r) => r.status },
  { id: "sound", header: "Sound", cell: (r) => r.sound },
  {
    id: "submitted",
    header: "Submitted",
    mobileHidden: true,
    cell: (r) => r.submitted,
  },
  {
    id: "actions",
    header: "Access",
    role: "actions",
    hideHeader: true,
    cell: (r) => <button type="button">Open {r.name}</button>,
  },
];

describe("projectColumnsToCard", () => {
  it("routes each column to its card slot by role", () => {
    const p = projectColumnsToCard(columns);
    expect(p.title.map((c) => c.id)).toEqual(["name"]);
    expect(p.badges.map((c) => c.id)).toEqual(["status"]);
    expect(p.actions.map((c) => c.id)).toEqual(["actions"]);
    expect(p.pairs.map((c) => c.id)).toEqual(["sound"]);
  });

  it("excludes mobileHidden columns from every card slot", () => {
    const p = projectColumnsToCard(columns);
    expect(p.hidden.map((c) => c.id)).toEqual(["submitted"]);
    const shown = [...p.title, ...p.badges, ...p.actions, ...p.pairs];
    expect(shown.some((c) => c.id === "submitted")).toBe(false);
  });

  it("treats a column with no role as a label/value pair", () => {
    const p = projectColumnsToCard<Row>([
      { id: "sound", header: "Sound", cell: (r) => r.sound },
    ]);
    expect(p.pairs.map((c) => c.id)).toEqual(["sound"]);
    expect(p.title).toHaveLength(0);
  });

  it("lets mobileHidden win over an assigned role", () => {
    const p = projectColumnsToCard<Row>([
      {
        id: "name",
        header: "Camp",
        role: "title",
        mobileHidden: true,
        cell: (r) => r.name,
      },
    ]);
    expect(p.hidden.map((c) => c.id)).toEqual(["name"]);
    expect(p.title).toHaveLength(0);
  });

  it("preserves declaration order within a slot", () => {
    const p = projectColumnsToCard<Row>([
      { id: "a", header: "A", cell: () => "a" },
      { id: "b", header: "B", cell: () => "b" },
      { id: "c", header: "C", cell: () => "c" },
    ]);
    expect(p.pairs.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("ResponsiveDataTable", () => {
  it("renders a real <table> with a header per column (plus mobileHidden)", () => {
    render(
      <ResponsiveDataTable
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
      />,
    );
    const table = screen.getByRole("table");
    // Column headers present in the desktop table (Access is sr-only text).
    expect(within(table).getByText("Camp")).toBeDefined();
    expect(within(table).getByText("Status")).toBeDefined();
    expect(within(table).getByText("Sound")).toBeDefined();
    // mobileHidden column still has its <th> at md+.
    expect(within(table).getByText("Submitted")).toBeDefined();
    // Every row value renders in the table.
    expect(within(table).getByText("Mad Hatters")).toBeDefined();
    expect(within(table).getByText("12 Feb 2027")).toBeDefined();
  });

  it("renders the mobile card list using column headers as pair labels", () => {
    render(
      <ResponsiveDataTable
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
      />,
    );
    const cards = screen.getByRole("list");
    // Pair column: label (header) + value both appear in the card region.
    const soundLabels = within(cards).getAllByText("Sound");
    expect(soundLabels.length).toBe(rows.length);
    expect(within(cards).getByText("Medium")).toBeDefined();
    // Title value is present in the card list.
    expect(within(cards).getByText("Camp 404")).toBeDefined();
  });

  it("omits mobileHidden columns from the card list entirely", () => {
    render(
      <ResponsiveDataTable
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
      />,
    );
    const cards = screen.getByRole("list");
    // "Submitted" header/value must not appear anywhere in the card region.
    expect(within(cards).queryByText("Submitted")).toBeNull();
    expect(within(cards).queryByText("12 Feb 2027")).toBeNull();
    expect(within(cards).queryByText("Not submitted")).toBeNull();
  });

  it("renders the empty state in place of both layouts when data is empty", () => {
    render(
      <ResponsiveDataTable
        columns={columns}
        data={[]}
        getRowKey={(r) => r.id}
        emptyState={<p>No registrations yet.</p>}
      />,
    );
    expect(screen.getByText("No registrations yet.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("adds an expand toggle per row when renderExpanded is provided", () => {
    render(
      <ResponsiveDataTable
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
        renderExpanded={(r) => <div>Detail for {r.name}</div>}
      />,
    );
    // One toggle in the table row + one in the mobile card, per row.
    const toggles = screen.getAllByRole("button", { name: /expand row/i });
    expect(toggles.length).toBe(rows.length * 2);
  });

  it("does not render expand toggles when renderExpanded is absent", () => {
    render(
      <ResponsiveDataTable
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
      />,
    );
    expect(screen.queryByRole("button", { name: /expand row/i })).toBeNull();
  });
});
