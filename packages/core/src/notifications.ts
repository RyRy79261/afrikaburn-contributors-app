// Notifications & bulletins domain logic (docs/notifications-spec.md).
//
// PURITY CONTRACT (same as the rest of @quagga/core): no I/O, no env, no DB.
// These builders turn already-safe event facts into notification PAYLOADS, and
// the bulletin consumer fans an audience out to per-recipient rows. The DB
// insert + email send are the caller's (app) responsibility.
//
// PRIVACY LAW: a builder only ever receives + emits safe, display-level fields
// (camp names, statuses, role/officer labels, standing labels, bulletin titles).
// It NEVER takes or echoes an always-private field (phone, emergency
// contacts, SA ID / passport, medical). `notificationMentionsAny` is the
// test-facing guard that proves a payload leaks none of a forbidden value set.
//
// AUDIENCE: bulletins reuse the questionnaire resolver verbatim — one resolver
// (`resolveAudience`), two consumers (questionnaire activation + bulletins).

import type {
  AudienceSpec,
  NotificationKind,
  NotificationPayload,
  RegistrationStatus,
} from "@quagga/types";
import { resolveAudience, type AudienceContext } from "./audience";

// Re-export the payload shapes so consumers can pull them (and the row type
// below) from a single @quagga/core import.
export type { NotificationKind, NotificationPayload } from "@quagga/types";

// --- Payload builders ----------------------------------------------------
// Each returns a NotificationPayload. `body`/`link` default to null when there
// is nothing safe to add.

/** Registration decisions that generate a participant notification. */
export type RegistrationDecision = Extract<
  RegistrationStatus,
  "approved" | "changes_requested" | "rejected"
>;

/** 🎉 A reviewer decided a camp's registration (approve / changes / reject). */
export function registrationDecisionNotification(input: {
  campName: string;
  decision: RegistrationDecision;
  campSlug?: string | null;
}): NotificationPayload {
  const link = input.campSlug ? `/camps/${input.campSlug}` : null;
  switch (input.decision) {
    case "approved":
      return {
        kind: "registration",
        title: `${input.campName} has been approved — placement application is now open`,
        body: null,
        link,
      };
    case "changes_requested":
      return {
        kind: "registration",
        title: `${input.campName}: AfrikaBurn has requested changes to your registration`,
        body: "Open your registration to see what to update.",
        link,
      };
    case "rejected":
      return {
        kind: "registration",
        title: `${input.campName}: your registration was not accepted this edition`,
        body: null,
        link,
      };
  }
}

/** 📋 A questionnaire was released to this user. Blocking ones flag hard.
 *
 * `from` names the sender — "AfrikaBurn" for an org release, the camp's name for
 * a camp release. It defaults to AfrikaBurn because that was the only caller
 * until camp activations started writing inbox rows too (audit M7); attributing
 * a camp's questionnaire to AfrikaBurn would be simply untrue. */
export function questionnaireReleasedNotification(input: {
  title: string;
  blocking: boolean;
  activationId?: string | null;
  from?: string;
}): NotificationPayload {
  const from = input.from?.trim() || "AfrikaBurn";
  return {
    kind: "questionnaire",
    title: input.blocking
      ? `New questionnaire from ${from}: ${input.title} — REQUIRED, blocks registration`
      : `New questionnaire from ${from}: ${input.title}`,
    body: null,
    link: input.activationId ? `/questionnaires/${input.activationId}` : null,
  };
}

/** 🧑‍🚒 A member was assigned an officer role and must accept (consent flow). */
export function officerAssignmentRequestNotification(input: {
  officerLabel: string;
  campName: string;
  campSlug?: string | null;
}): NotificationPayload {
  return {
    kind: "role",
    title: `${input.campName} would like you to be their ${input.officerLabel}`,
    body: "Accept to let AfrikaBurn contact you about this role, or decline.",
    link: input.campSlug ? `/camps/${input.campSlug}` : null,
  };
}

/** 🧑‍🚒 An officer accepted their registration (org can now contact them). */
export function officerAcceptedNotification(input: {
  officerLabel: string;
  campName: string;
  campSlug?: string | null;
}): NotificationPayload {
  return {
    kind: "role",
    title: `${input.officerLabel} registration accepted — AfrikaBurn can now contact you`,
    body: `You're the ${input.officerLabel} for ${input.campName}.`,
    link: input.campSlug ? `/camps/${input.campSlug}` : null,
  };
}

/** 🧭 A wrangler was assigned to a camp (no action wires this yet — builder
 * ready for when wrangler assignment ships, per docs/roadmap.md). */
export function wranglerAssignedNotification(input: {
  wranglerName: string;
  campName: string;
  campSlug?: string | null;
}): NotificationPayload {
  return {
    kind: "wrangler",
    title: `${input.wranglerName} from the theme camp leads team is now your wrangler`,
    body: `They'll help ${input.campName} through the process.`,
    link: input.campSlug ? `/camps/${input.campSlug}` : null,
  };
}

/** 📦 A supplier's standing changed (value only, never notes). Supplier-only. */
export function supplierStandingNotification(input: {
  standingLabel: string;
}): NotificationPayload {
  return {
    kind: "supplier",
    title: `Standing changed to ${input.standingLabel}`,
    body: null,
    link: "/onboarding",
  };
}

/** 📦 AfrikaBurn confirmed one of a supplier's org-confirmed onboarding steps. */
export function supplierStepConfirmedNotification(input: {
  stepLabel: string;
}): NotificationPayload {
  return {
    kind: "supplier",
    title: `${input.stepLabel} — confirmed by AfrikaBurn`,
    body: null,
    link: "/onboarding",
  };
}

// (No per-view medical notification. Medical notes are disclosed to a stated
// audience — the burner's camp leads and AfrikaBurn's safety staff — at the
// point of entry, so a notification every time one of them opens the burner's
// detail would be noise, not consent. The read is still audited server-side; see
// ./medical-access.)

/** 📣 A bulletin broadcast landed in this recipient's inbox. */
export function bulletinNotification(input: {
  bulletinTitle: string;
  bulletinId: string;
}): NotificationPayload {
  return {
    kind: "bulletin",
    title: input.bulletinTitle,
    body: null,
    link: `/bulletins/${input.bulletinId}`,
  };
}

// --- Bulletin fan-out (shared audience resolver) -------------------------

/** A ready-to-insert notification row (payload + its recipient). */
export interface NotificationRow extends NotificationPayload {
  userId: string;
  bulletinId?: string | null;
}

/**
 * Resolve a bulletin's audience to user ids — the SAME resolver questionnaires
 * use (one resolver, two consumers). Thin wrapper so the bulletin call site
 * reads intently and stays a single seam.
 */
export function resolveBulletinAudience(
  spec: AudienceSpec,
  ctx: AudienceContext,
): string[] {
  return resolveAudience(spec, ctx);
}

/**
 * Fan a published bulletin out to one notification row per resolved recipient.
 * De-duplication + sorting come from `resolveAudience`; this just projects.
 */
export function buildBulletinNotifications(
  input: { bulletinId: string; title: string },
  userIds: readonly string[],
): NotificationRow[] {
  const payload = bulletinNotification({
    bulletinTitle: input.title,
    bulletinId: input.bulletinId,
  });
  return userIds.map((userId) => ({
    ...payload,
    userId,
    bulletinId: input.bulletinId,
  }));
}

// --- Email gating --------------------------------------------------------

/**
 * Immediate transactional email is sent ONLY for registration decisions and
 * BLOCKING questionnaire releases (docs/notifications-spec.md §Email). Every
 * other notification waits for the daily unread digest. In-app is the source of
 * truth (offline law) — email is a courtesy nudge.
 */
export function shouldSendImmediateEmail(
  kind: NotificationKind,
  opts?: { blocking?: boolean },
): boolean {
  if (kind === "registration") return true;
  if (kind === "questionnaire") return opts?.blocking === true;
  return false;
}

// --- Privacy guard (test-facing) -----------------------------------------

/**
 * True if any of `needles` appears in the payload's user-visible text
 * (title / body / link). The privacy tests use this to PROVE a built payload
 * leaks no hard-locked value (a phone number, an ID, an emergency contact).
 * Empty/blank needles are ignored so they can't produce false positives.
 */
export function notificationMentionsAny(
  payload: NotificationPayload,
  needles: readonly string[],
): boolean {
  const haystack = [payload.title, payload.body ?? "", payload.link ?? ""]
    .join("\n")
    .toLowerCase();
  return needles.some((n) => {
    const needle = n.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

// --- Unread count --------------------------------------------------------

/**
 * Unread = `read_at IS NULL`. The header bell's real query counts exactly this
 * predicate in SQL; this pure mirror is the unit-tested definition of "unread"
 * so the two can never drift.
 */
export function isUnread(n: { readAt: Date | null }): boolean {
  return n.readAt === null;
}

/** Count unread notifications in a set (the bell badge number). */
export function countUnread(
  notifications: readonly { readAt: Date | null }[],
): number {
  return notifications.reduce((n, item) => (isUnread(item) ? n + 1 : n), 0);
}

// --- Day grouping (inbox list) -------------------------------------------

export interface DayGroup<T> {
  /** Stable day key, YYYY-MM-DD in the caller's locale-neutral terms. */
  key: string;
  /** Human label: "Today", "Yesterday", else the date key. */
  label: string;
  items: T[];
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Group already-sorted (newest-first) items by calendar day, labelling the
 * two most recent days "Today"/"Yesterday". Pure — `now` is injectable for
 * deterministic tests.
 */
export function groupNotificationsByDay<T extends { createdAt: Date }>(
  items: readonly T[],
  now: Date = new Date(),
): DayGroup<T>[] {
  const todayKey = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);

  const groups: DayGroup<T>[] = [];
  let current: DayGroup<T> | null = null;
  for (const item of items) {
    const key = dayKey(item.createdAt);
    if (!current || current.key !== key) {
      const label: string =
        key === todayKey ? "Today" : key === yesterdayKey ? "Yesterday" : key;
      current = { key, label, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}
