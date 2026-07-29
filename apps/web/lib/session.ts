import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  BURNER_BIO_ACTION_KEY,
  firstBlockingAction,
  canBootstrapGod,
  isSanitized,
  parseGodEmails,
} from "@quagga/core";
import { db, schema } from "./db";
import { isDatabaseConfigured } from "./config";
import { getActiveEdition } from "./edition";
import { getAuthenticatedUser, type AuthenticatedUser } from "./auth";
import {
  actionRoute,
  ensureRequiredAction,
  listRequiredActions,
} from "./required-actions";

/** The camp-side user row (joins to Neon Auth via auth_user_id). */
export interface CampUser {
  id: string;
  authUserId: string;
  email: string | null;
  /** The account-level handle (@quagga/core `username.ts`), or null — it is
   * OPTIONAL, so every reader must cope with its absence. */
  username: string | null;
}

/** The single seeded org group ("AfrikaBurn"), or null if not seeded. */
export async function getOrgGroup(): Promise<{ id: string } | null> {
  const rows = await db()
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.kind, "org"))
    .limit(1);
  return rows[0] ?? null;
}

/** Record the god elevation in `audit_events` (build-spec §audit_events:
 * "Written on: elevation"). Self-actor — the grant is driven by GOD_EMAILS. */
async function auditGodElevation(user: CampUser): Promise<void> {
  await db()
    .insert(schema.auditEvents)
    .values({
      actorId: user.id,
      action: "account.elevate",
      subject: user.id,
      meta: { email: user.email, role: "god", via: "god_emails" },
    });
}

/**
 * On the first authenticated request, grant god membership on the org group to
 * any GOD_EMAILS-listed user whose email the auth provider has VERIFIED
 * (build-spec §Env `GOD_EMAILS`). Idempotent; a no-op when the org group isn't
 * seeded, the email isn't listed, or it is unverified. Writes an audit event
 * when a god membership is actually created or changed.
 */
async function bootstrapGod(
  user: CampUser,
  emailVerified: boolean,
): Promise<void> {
  if (
    !canBootstrapGod(
      user.email,
      emailVerified,
      parseGodEmails(process.env.GOD_EMAILS),
    )
  ) {
    return;
  }
  const org = await getOrgGroup();
  if (!org) return;
  const existing = await db()
    .select({ id: schema.memberships.id, role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.groupId, org.id),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    const inserted = await db()
      .insert(schema.memberships)
      .values({ userId: user.id, groupId: org.id, role: "god" })
      .onConflictDoNothing({
        target: [schema.memberships.userId, schema.memberships.groupId],
      })
      .returning({ id: schema.memberships.id });
    // Only audit when the insert actually created the god row (no conflict).
    if (inserted[0]) await auditGodElevation(user);
  } else if (existing[0].role !== "god") {
    await db()
      .update(schema.memberships)
      .set({ role: "god" })
      .where(eq(schema.memberships.id, existing[0].id));
    await auditGodElevation(user);
  }
}

/**
 * Upsert the camp-side `users` row for an authenticated Neon Auth user, run the
 * GOD_EMAILS bootstrap, and ensure the blocking Burner Bio required action
 * exists. Returns the camp user, or null when the DB isn't configured.
 *
 * `cache()`d on the auth user id, per request. This is not just a read: it is an
 * upsert plus two guard queries plus the required-action check, and a single
 * page render used to run the whole thing two or three times over (the shell's
 * unread count, the page's own guard, the gate). Every step is idempotent, so
 * collapsing them to one changes nothing except the number of round trips. The
 * cache lives and dies with the request, so it can never hand one account's row
 * to another.
 */
export const ensureCampUser = cache(async function ensureCampUser(
  authUser: AuthenticatedUser,
): Promise<CampUser | null> {
  if (!isDatabaseConfigured()) return null;

  await db()
    .insert(schema.users)
    .values({ authUserId: authUser.id, email: authUser.primaryEmail })
    .onConflictDoNothing({ target: schema.users.authUserId });

  const rows = await db()
    .select({
      id: schema.users.id,
      authUserId: schema.users.authUserId,
      email: schema.users.email,
      username: schema.users.username,
      sanitizedAt: schema.users.sanitizedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.authUserId, authUser.id))
    .limit(1);
  const campUser = rows[0];
  if (!campUser) return null;

  // THE re-animation guard. A deleted-and-sanitized account keeps its `users`
  // row (memberships, roles and audit history survive for integrity), so handing
  // it back a session would silently re-adopt a stranger's — possibly a camp
  // lead's — permissions and un-erase the account. The tombstone is still
  // findable here because sanitization leaves `auth_user_id` unchanged; refuse
  // rather than mint or bootstrap anything. The Better Auth identity is already
  // deleted, so a real session cannot reach this — but the cookie cache can serve
  // a stale one for up to its 5-minute maxAge, which is exactly what this stops.
  if (isSanitized(campUser)) return null;

  // Keep the email fresh (it may have been null at insert or changed upstream).
  if (authUser.primaryEmail && campUser.email !== authUser.primaryEmail) {
    await db()
      .update(schema.users)
      .set({ email: authUser.primaryEmail })
      .where(eq(schema.users.id, campUser.id));
    campUser.email = authUser.primaryEmail;
  }

  await bootstrapGod(campUser, authUser.emailVerified);
  // Per edition (migration 0024): the bio persists, but it is CONFIRMED once
  // per burn, so this raises a fresh action for the edition now running rather
  // than finding last year's completed row and staying silent.
  const activeEdition = await getActiveEdition();
  if (activeEdition) {
    await ensureRequiredAction({
      userId: campUser.id,
      editionId: activeEdition.id,
      actionKey: BURNER_BIO_ACTION_KEY,
      type: "questionnaire",
      title: "Complete your Burner Bio",
    });
  }

  return campUser;
});

/** The current camp user (upserted + bootstrapped), or null when signed out /
 * unconfigured. Never throws. Request-scoped via `ensureCampUser`. */
export async function getCurrentCampUser(): Promise<CampUser | null> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) return null;
  try {
    return await ensureCampUser(authUser);
  } catch {
    return null;
  }
}

/** Require a signed-in camp user; redirect to sign-in otherwise. */
export async function requireCampUser(): Promise<CampUser> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");
  const campUser = await ensureCampUser(authUser);
  if (!campUser) redirect("/auth/sign-in");
  return campUser;
}

/**
 * The route a user is currently GATED to, or null when nothing blocks them. The
 * first pending blocking `required_action` (creation order = priority) maps to
 * its fill route: the Burner Bio → /onboarding; a questionnaire activation →
 * /questionnaires/<id>. This is the hard-gate spine (questionnaire-spec
 * §"Engine mechanics"): while it returns non-null, the app routes the user
 * there before anything else. Falls back to /onboarding for an unroutable key.
 */
export async function pendingBlockingRoute(
  userId: string,
): Promise<string | null> {
  const actions = await listRequiredActions(userId);
  const blocker = firstBlockingAction(actions);
  if (!blocker) return null;
  return actionRoute(blocker.actionKey) ?? "/onboarding";
}

/**
 * Is the CURRENT viewer behind the hard gate? For chrome, not for authorisation
 * — `enforceGate` is what actually refuses.
 *
 * The gate page draws itself "stripped to a band + brand mark + sign-out — no
 * nav can leak an escape" (questionnaires/[activationId]/page.tsx), and that
 * stopped being true when AppShell was hoisted from the pages into
 * `(app)/layout.tsx`: the layout wraps every route in the group, so the gate
 * rendered the full participant nav — Directory, Create camp, Profile, Account
 * — ABOVE its own minimal header. Two headers, and the one thing the page
 * promised not to show. The e2e spec that would have caught it was among those
 * timing out.
 *
 * Costs nothing on a gated surface: both reads below are request-`cache()`d and
 * the page's own `enforceGate` asks for exactly the same rows.
 */
export async function viewerIsGated(): Promise<boolean> {
  const campUser = await getCurrentCampUser();
  if (!campUser) return false;
  return (await pendingBlockingRoute(campUser.id)) !== null;
}

/**
 * Enforce the hard gate for a signed-in camp user: if a blocking action is
 * pending, redirect to its fill route unless the caller is ALREADY on that
 * route (`currentPath`) — so the fill page itself renders instead of looping.
 * Every gated participant surface calls this.
 */
export async function enforceGate(
  userId: string,
  currentPath?: string,
): Promise<void> {
  const route = await pendingBlockingRoute(userId);
  if (route && route !== currentPath) redirect(route);
}

/**
 * Require a signed-in, fully-onboarded camp user. Redirects to the pending
 * blocking action's fill route (the Burner Bio → /onboarding, a questionnaire
 * → its fill page) when anything still blocks — the app-wide gate.
 */
export async function requireOnboardedUser(): Promise<CampUser> {
  const campUser = await requireCampUser();
  await enforceGate(campUser.id);
  return campUser;
}
