/**
 * WHO LOSES WHAT — the arithmetic behind every destructive confirmation on the
 * roles screen.
 *
 * Deleting a department cascades its roles away (`org_roles.department_id ON
 * DELETE CASCADE`) and every assignment of them with it. Deleting a custom role
 * releases everyone holding it. Both are one click, both are irreversible, and
 * both can leave a colleague signed in to a console that does nothing — so the
 * dialog has to say so BEFORE the click, naming the people, not after it in a
 * toast.
 *
 * Kept pure and separate from the query so the rule can be tested without a
 * database: the query fetches the assignment rows, this decides what they mean.
 *
 * PERSONAL INFORMATION: `label` is an email address when the caller may read one
 * and a username otherwise. This module never chooses — `getOrgRoleImpacts` is
 * called only for a System manager (who resolves `read_personal_information` by
 * anchor), and the labels never reach anyone else's payload because the read
 * itself does not happen. See apps/org/lib/queries.ts.
 */

/** One (person, role) assignment, flattened, as the query returns it. */
export interface AssignmentRow {
  userId: string;
  /** Email or username — whatever the caller is entitled to see. */
  label: string;
  roleId: string;
  /** The department the ROLE is scoped to, or null for an org-wide role. */
  departmentId: string | null;
}

/** What happens to people when a role or a whole department is deleted. */
export interface DeletionImpact {
  /** Distinct accounts holding at least one of the roles being removed. */
  people: number;
  /**
   * Of those, how many hold NO other org role afterwards — the ones who would
   * be left able to sign in and do nothing. The number that decides whether the
   * dialog is a formality or a warning.
   */
  leftWithNothing: number;
  /** Who they are, in stable order, so the dialog can name them. */
  labels: string[];
}

/** An impact with nobody in it — the "nobody loses anything" case, named. */
export function noImpact(): DeletionImpact {
  return { people: 0, leftWithNothing: 0, labels: [] };
}

function impactOf(
  rows: readonly AssignmentRow[],
  doomed: (row: AssignmentRow) => boolean,
): DeletionImpact {
  const rolesByUser = new Map<string, { label: string; kept: number; lost: number }>();
  for (const row of rows) {
    const entry = rolesByUser.get(row.userId) ?? {
      label: row.label,
      kept: 0,
      lost: 0,
    };
    if (doomed(row)) entry.lost += 1;
    else entry.kept += 1;
    rolesByUser.set(row.userId, entry);
  }

  const affected = [...rolesByUser.values()].filter((e) => e.lost > 0);
  return {
    people: affected.length,
    leftWithNothing: affected.filter((e) => e.kept === 0).length,
    labels: affected.map((e) => e.label).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Every impact the roles screen needs, in one pass over the assignment rows:
 * per role (deleting that role) and per department (deleting the department,
 * which takes ALL of its roles — the seeded lead/member pair AND any custom role
 * scoped to it).
 */
export function computeOrgRoleImpacts(rows: readonly AssignmentRow[]): {
  byRole: Map<string, DeletionImpact>;
  byDepartment: Map<string, DeletionImpact>;
} {
  const byRole = new Map<string, DeletionImpact>();
  const byDepartment = new Map<string, DeletionImpact>();

  for (const roleId of new Set(rows.map((r) => r.roleId))) {
    byRole.set(
      roleId,
      impactOf(rows, (row) => row.roleId === roleId),
    );
  }

  const departmentIds = new Set(
    rows
      .map((r) => r.departmentId)
      .filter((id): id is string => id !== null),
  );
  for (const departmentId of departmentIds) {
    byDepartment.set(
      departmentId,
      impactOf(rows, (row) => row.departmentId === departmentId),
    );
  }

  return { byRole, byDepartment };
}
