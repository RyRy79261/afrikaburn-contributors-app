import { z } from "zod";
import { AudienceSpec } from "./audience";

// Notifications & bulletins (docs/notifications-spec.md). One inbox, two
// origins: personal event notifications + org `bulletin` broadcasts. This file
// is the VALIDATION authority for the notification shapes; the storage
// authority is `notifications` / `bulletins` in @quagga/db schema.ts, and the
// leading-glyph map lives in @quagga/ui's NotificationItem. Keep the three in
// sync (same kind order as `notificationKindEnum`).

/**
 * The kind of a notification — selects the leading glyph and, for bulletins,
 * marks the org-broadcast origin. Mirrors `notificationKindEnum` in
 * @quagga/db schema.ts and `NotificationKind` in @quagga/ui.
 */
export const NotificationKind = z.enum([
  "registration",
  "wrangler",
  "role",
  "questionnaire",
  "supplier",
  "security",
  "bulletin",
  // Camp shifts (epic #57): assigned, handed on, changed or cancelled.
  "shift",
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * A notification payload — the safe, already-projected copy that lands in an
 * inbox. Built ONLY by the @quagga/core payload builders, which never include
 * always-private fields (phone, emergency contacts, ID/passport, medical)
 * in `title`/`body`/`link` (privacy law). `link` is an in-app relative path.
 */
export const NotificationPayload = z.object({
  kind: NotificationKind,
  title: z.string().min(1),
  body: z.string().nullable().default(null),
  link: z.string().nullable().default(null),
});
export type NotificationPayload = z.infer<typeof NotificationPayload>;

/**
 * Org bulletin compose input (org console → Bulletins → new). Informational
 * only: title + markdown body + audience + optional pin. Nothing else — a
 * bulletin never collects data (fewer-forms law). `publish` true stamps
 * `published_at` and fans out notifications; false saves a draft.
 */
export const BulletinComposeInput = z.object({
  title: z.string().trim().min(1, "Give the bulletin a title.").max(200),
  bodyMd: z.string().trim().min(1, "Write the bulletin body.").max(20000),
  audience: AudienceSpec,
  pinned: z.boolean().default(false),
  publish: z.boolean().default(false),
});
export type BulletinComposeInput = z.infer<typeof BulletinComposeInput>;

// --- Camp announcements (epic #56) ----------------------------------------
// A camp announcement is a `bulletins` row with `group_id` set: the same
// broadcast spine the org uses, authored by a camp member holding
// `post_announcements` and addressed to that camp's own members only.

/**
 * How an announcement LANDS for its recipient.
 *
 * - `feed`        — an ordinary inbox item.
 * - `acknowledge` — must-acknowledge: a full-screen gate whose only way
 *                   forward is ticking "I've read this" (and whose only other
 *                   reachable action is signing out), mirroring the blocking-
 *                   questionnaire gate. Stamps `acknowledged_at` on the
 *                   recipient's OWN delivery row.
 *
 * Mirrors `bulletinPresentationEnum` in @quagga/db schema.ts.
 */
export const AnnouncementPresentation = z.enum(["feed", "acknowledge"]);
export type AnnouncementPresentation = z.infer<typeof AnnouncementPresentation>;

/**
 * The optional meeting link. Just a URL — nothing is fetched, embedded or
 * previewed — and only `https:` is accepted, so an announcement can never
 * carry a `javascript:` / `data:` / plain-http link to every member of a camp.
 */
export const MeetingUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long.")
  .pipe(
    z.url({
      protocol: /^https$/,
      hostname: z.regexes.domain,
      error: "Use a full https:// link.",
    }),
  );

/**
 * The camp announcement composer's input (save a draft). Title + markdown body
 * + audience + presentation + optional pin, meeting link and scheduled time.
 * Nothing that collects data from recipients (fewer-forms law) and no field
 * about any member (announcements carry no personal data).
 */
export const CampAnnouncementDraftInput = z.object({
  slug: z.string().min(1),
  /** Present when editing an existing DRAFT. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Give the announcement a title.").max(200),
  bodyMd: z
    .string()
    .trim()
    .min(1, "Write the announcement.")
    .max(20000, "That announcement is too long."),
  mode: z.enum(["everyone", "roles"]),
  roleIds: z.array(z.string().uuid()).max(100).default([]),
  presentation: AnnouncementPresentation.default("feed"),
  pinOnPublish: z.boolean().default(false),
  /** Empty string from the form means "no link". */
  meetingUrl: z
    .union([z.literal(""), MeetingUrl])
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
  /** ISO instant; null / empty = send immediately on publish. */
  sendAt: z
    .union([z.literal(""), z.string().datetime({ offset: true })])
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
});
export type CampAnnouncementDraftInput = z.input<
  typeof CampAnnouncementDraftInput
>;

/** Notification list filter tabs (the /notifications surface). */
export const NotificationFilter = z.enum(["all", "unread", "bulletins"]);
export type NotificationFilter = z.infer<typeof NotificationFilter>;
