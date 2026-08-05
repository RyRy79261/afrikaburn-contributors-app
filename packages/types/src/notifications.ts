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

/** Notification list filter tabs (the /notifications surface). */
export const NotificationFilter = z.enum(["all", "unread", "bulletins"]);
export type NotificationFilter = z.infer<typeof NotificationFilter>;
