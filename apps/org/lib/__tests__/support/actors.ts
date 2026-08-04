import {
  buildDomainOwnership,
  type DomainOwnership,
  type OrgActor,
  type OrgRoleGrant,
} from "@quagga/core";
import type { OrgPermissions } from "@quagga/types";

/**
 * THE DEPLOYMENT THESE TESTS RUN AGAINST — a Suppliers department that owns the
 * two supply-related domains, and a Theme camps department that owns
 * registrations. Audit, accounts and questionnaires are UNOWNED, which is the
 * state a real console spends its first week in and the one most likely to be
 * got wrong: an unowned domain is reachable by an org-wide role alone, and a
 * department-scoped role reaches nothing there.
 *
 * Fixtures are built exactly the way `packages/core/src/__tests__/org-permissions.test.ts`
 * builds them, because that is the resolver these modules ask. `OrgPermissions`
 * is a FLAT boolean map — the DOMAIN comes from the role's `departmentId` plus
 * this ownership map, never from a key inside `permissions`.
 */
export const SUPPLIERS_DEPT = "dept-suppliers";
export const CAMPS_DEPT = "dept-theme-camps";

export const OWNERSHIP: DomainOwnership = buildDomainOwnership([
  {
    domain: "suppliers",
    departmentId: SUPPLIERS_DEPT,
    departmentName: "Suppliers",
  },
  {
    domain: "supplier_documents",
    departmentId: SUPPLIERS_DEPT,
    departmentName: "Suppliers",
  },
  {
    domain: "registrations",
    departmentId: CAMPS_DEPT,
    departmentName: "Theme camps",
  },
]);

/** A role grant, defaulting to org-wide. */
export function role(
  key: string,
  permissions: OrgPermissions,
  departmentId: string | null = null,
): OrgRoleGrant {
  return {
    id: `role-${key}`,
    key,
    name: key,
    kind: "custom",
    departmentId,
    permissions,
  };
}

function actor(rank: OrgActor["rank"], roles: OrgRoleGrant[]): OrgActor {
  return { rank, roles, domains: OWNERSHIP };
}

/** The anchor: resolves every capability in every domain with no roles at all. */
export const GOD: OrgActor = actor("god", []);

/** Org-wide reader — sees the console, and not one personal column. */
export const READER: OrgActor = actor("org_staff", [
  role("reader", { read: true }),
]);

/** Org-wide reader of personal information, in every domain. */
export const PERSONAL_READER: OrgActor = actor("org_staff", [
  role("privacy", { read: true, personal_information: true }),
]);

/**
 * A Suppliers lead: personal information, but ONLY in the two domains their
 * department owns. The 27 Jul 2026 per-domain rule exists for exactly this
 * actor — they read a supplier note's author, and must be refused a theme
 * camp's phone numbers and medical notes.
 */
export const SUPPLIERS_LEAD: OrgActor = actor("org_staff", [
  role(
    "suppliers.lead",
    { read: true, update: true, delete: true, personal_information: true },
    SUPPLIERS_DEPT,
  ),
]);

/** The mirror image: personal information in `registrations` and nowhere else. */
export const CAMPS_LEAD: OrgActor = actor("org_staff", [
  role(
    "camps.lead",
    {
      create: true,
      read: true,
      update: true,
      delete: true,
      personal_information: true,
    },
    CAMPS_DEPT,
  ),
]);

/** Holds the console door and nothing else — the half-finished grant. */
export const NO_ROLES: OrgActor = actor("org_staff", []);
