import { describe, it, expect } from "vitest";
import {
  ORG_DOMAINS,
  ORG_DOMAIN_DESCRIPTIONS,
  ORG_DOMAIN_LABELS,
  buildDomainOwnership,
  departmentDomainsNote,
  departmentForDomain,
  departmentOwning,
  domainsOwnedBy,
  isOrgDomain,
  listDomainLabels,
  unownedDomains,
  NO_DOMAIN_OWNERSHIP,
} from "../org-domains";

// WHAT A DEPARTMENT OWNS — the vocabulary and the ownership map.
//
// The list itself is a fact about apps/org, so the tests here are about the
// MAP's behaviour rather than about which keys exist: exclusivity, the unowned
// state, and unknown keys failing closed.

describe("the domain vocabulary", () => {
  it("has a label and a description for every domain", () => {
    for (const domain of ORG_DOMAINS) {
      expect(ORG_DOMAIN_LABELS[domain]).toBeTruthy();
      expect(ORG_DOMAIN_DESCRIPTIONS[domain].length).toBeGreaterThan(30);
    }
  });

  it("is a set of unique keys", () => {
    expect(new Set(ORG_DOMAINS).size).toBe(ORG_DOMAINS.length);
  });

  it("recognises its own keys and nothing else", () => {
    for (const domain of ORG_DOMAINS) expect(isOrgDomain(domain)).toBe(true);
    expect(isOrgDomain("notifications")).toBe(false);
    expect(isOrgDomain("")).toBe(false);
    expect(isOrgDomain("SUPPLIERS")).toBe(false);
  });

  it("says out loud which domains are INERT, so a checkbox is never a false promise", () => {
    // `bulletins` and `camp_categories` have no personal column and no
    // destructive guard, so owning them changes nothing today. A tick that
    // reads as access and grants none is the exact trap this change removes —
    // the description carries the caveat, and this asserts it stays there.
    for (const inert of ["bulletins", "camp_categories"] as const) {
      expect(ORG_DOMAIN_DESCRIPTIONS[inert]).toMatch(
        /does not change what anyone can do yet/i,
      );
    }
    // …and the domains that DO carry a scoped capability make no such excuse.
    for (const live of [
      "registrations",
      "suppliers",
      "supplier_documents",
      "questionnaires",
      "accounts",
      "audit",
    ] as const) {
      expect(ORG_DOMAIN_DESCRIPTIONS[live]).not.toMatch(
        /does not change what anyone can do/i,
      );
    }
  });

  it("covers the surfaces that hold personal information or destroy rows", () => {
    // Not a taxonomy check — a coverage check. Every console area that either
    // returns a person or has a delete guard must be nameable, or its queries
    // would have nothing honest to ask for.
    for (const required of [
      "registrations",
      "suppliers",
      "supplier_documents",
      "questionnaires",
      "accounts",
      "audit",
    ] as const) {
      expect(ORG_DOMAINS).toContain(required);
    }
  });
});

describe("the ownership map", () => {
  const ownership = buildDomainOwnership([
    { domain: "suppliers", departmentId: "d1", departmentName: "Suppliers" },
    {
      domain: "supplier_documents",
      departmentId: "d1",
      departmentName: "Suppliers",
    },
    {
      domain: "registrations",
      departmentId: "d2",
      departmentName: "Theme camps",
    },
  ]);

  it("resolves a domain to its owning department, by id and by name", () => {
    expect(departmentForDomain(ownership, "suppliers")).toBe("d1");
    expect(departmentOwning(ownership, "registrations")).toEqual({
      id: "d2",
      name: "Theme camps",
    });
  });

  it("resolves an UNOWNED domain to no department — the fail-closed state", () => {
    expect(departmentForDomain(ownership, "bulletins")).toBeNull();
    expect(departmentOwning(ownership, "audit")).toBeNull();
    expect(departmentForDomain(ownership, null)).toBeNull();
    expect(departmentForDomain(NO_DOMAIN_OWNERSHIP, "suppliers")).toBeNull();
  });

  it("lists what one department owns, in vocabulary order", () => {
    expect(domainsOwnedBy(ownership, "d1")).toEqual([
      "suppliers",
      "supplier_documents",
    ]);
    expect(domainsOwnedBy(ownership, "d2")).toEqual(["registrations"]);
    // A department nobody gave anything to — the state that makes a scoped role
    // reach nothing, and the reason this returns [] rather than throwing.
    expect(domainsOwnedBy(ownership, "d3")).toEqual([]);
    expect(domainsOwnedBy(ownership, null)).toEqual([]);
  });

  it("lists what nobody owns", () => {
    expect(unownedDomains(ownership)).toEqual([
      "questionnaires",
      "bulletins",
      "camp_categories",
      "accounts",
      "audit",
    ]);
    expect(unownedDomains(NO_DOMAIN_OWNERSHIP)).toEqual([...ORG_DOMAINS]);
  });

  it("DROPS a domain key this build does not know", () => {
    // A row left behind by a console area that was removed must own nothing
    // rather than resolve to an ownership no screen can see or edit.
    const withJunk = buildDomainOwnership([
      { domain: "suppliers", departmentId: "d1", departmentName: "Suppliers" },
      { domain: "placement_maps", departmentId: "d9", departmentName: "Ghost" },
    ]);
    expect(domainsOwnedBy(withJunk, "d9")).toEqual([]);
    expect(Object.keys(withJunk)).toEqual(["suppliers"]);
  });

  it("keeps ONE owner per domain even if handed two rows", () => {
    // The database enforces this (primary key on `domain`); this makes it
    // order-independent in memory too, rather than "whichever row came last".
    const contested = buildDomainOwnership([
      { domain: "suppliers", departmentId: "d1", departmentName: "Suppliers" },
      { domain: "suppliers", departmentId: "d2", departmentName: "Safety" },
    ]);
    expect(departmentForDomain(contested, "suppliers")).toBe("d1");
    expect(domainsOwnedBy(contested, "d2")).toEqual([]);
  });
});

describe("the copy a System manager reads", () => {
  it("warns when a department owns nothing, because the role then grants nothing", () => {
    const note = departmentDomainsNote([]);
    expect(note).toMatch(/nothing at all/i);
    expect(note).toMatch(/org-wide/i);
  });

  it("names what a department reaches when it owns something", () => {
    const note = departmentDomainsNote(["suppliers", "supplier_documents"]);
    expect(note).toContain("suppliers");
    expect(note).toContain("supplier documents");
    expect(note).toMatch(/nothing else/i);
  });

  it("lists labels as a sentence, not an array", () => {
    expect(listDomainLabels([])).toBe("");
    expect(listDomainLabels(["suppliers"])).toBe("suppliers");
    expect(listDomainLabels(["suppliers", "bulletins"])).toBe(
      "suppliers and bulletins",
    );
    expect(
      listDomainLabels(["suppliers", "bulletins", "camp_categories"]),
    ).toBe("suppliers, bulletins and camp categories");
  });
});
