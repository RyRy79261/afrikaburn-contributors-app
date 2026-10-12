import { z } from "zod";

// Work Access Passes (epic #53, docs/wap-spec.md). This file is the VALIDATION
// authority for every WAP input crossing a server-action boundary; the storage
// authority is `wap_requests` / `wap_allocations` / the `wap_list_*` columns in
// @quagga/db schema.ts, and the rules live in @quagga/core
// work-access-passes.ts. Every input names ids and numbers only — who may act
// is decided server-side from the session, never from the payload.

/** Keep in sync with `wapRequestStatusEnum` in @quagga/db schema.ts. */
export const WapRequestStatus = z.enum(["pending", "granted", "declined"]);
export type WapRequestStatus = z.infer<typeof WapRequestStatus>;

/** Keep in sync with `wapListStatusEnum` in @quagga/db schema.ts. */
export const WapListStatus = z.enum([
  "draft",
  "submitted",
  "approved",
  "returned",
]);
export type WapListStatus = z.infer<typeof WapListStatus>;

/** The most passes one ask may name. A ceiling against typos, not a quota. */
export const WAP_REQUEST_MAX = 10_000;
export const WAP_REASON_MAX = 500;
export const WAP_RETURN_NOTE_MAX = 1_000;

const Uuid = z.string().uuid();
const Slug = z.string().min(1).max(200);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` that is a real calendar day ("2027-02-31" is refused). */
export const WapDate = z
  .string()
  .regex(ISO_DATE, "Pick a day.")
  .refine((v) => {
    const m = ISO_DATE.exec(v);
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return (
      d.getUTCFullYear() === Number(m[1]) &&
      d.getUTCMonth() === Number(m[2]) - 1 &&
      d.getUTCDate() === Number(m[3])
    );
  }, "Pick a day.");

const passCount = (what: string) =>
  z
    .number()
    .int(`${what} is a whole number.`)
    .min(1, `${what} is at least 1.`)
    .max(WAP_REQUEST_MAX, `${what} is at most ${WAP_REQUEST_MAX}.`);

/** Optional free text: blank becomes null. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

// --- Project side (the lead's Passes page) -------------------------------

/** Ask for passes — the first request or "ask for more". */
export const WapRequestInput = z
  .object({
    slug: Slug,
    requested: passCount("The number of passes"),
    reason: optionalText(
      WAP_REASON_MAX,
      `Keep the reason under ${WAP_REASON_MAX} characters.`,
    ),
  })
  .strict();
export type WapRequestInput = z.input<typeof WapRequestInput>;

/** Put a current member on the pass list. */
export const WapAllocateInput = z
  .object({ slug: Slug, membershipId: Uuid })
  .strict();
export type WapAllocateInput = z.infer<typeof WapAllocateInput>;

/** Take a name off the pass list. */
export const WapRemoveInput = z
  .object({ slug: Slug, allocationId: Uuid })
  .strict();
export type WapRemoveInput = z.infer<typeof WapRemoveInput>;

/**
 * The lead's corrections on one pass. Each field null = use the member's own
 * roster plan. Arrival may not be after departure when both are overridden.
 */
export const WapOverrideInput = z
  .object({
    slug: Slug,
    allocationId: Uuid,
    arrivalDate: WapDate.nullable(),
    departureDate: WapDate.nullable(),
    build: z.boolean().nullable(),
    strike: z.boolean().nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.arrivalDate === null ||
      v.departureDate === null ||
      v.arrivalDate <= v.departureDate,
    {
      message: "Arrival can't be after departure — check the dates.",
      path: ["departureDate"],
    },
  );
export type WapOverrideInput = z.infer<typeof WapOverrideInput>;

/** Send the list to AfrikaBurn. */
export const WapSubmitInput = z.object({ slug: Slug }).strict();
export type WapSubmitInput = z.infer<typeof WapSubmitInput>;

// --- Org side (registration review + passes overview) --------------------

/** Grant a pending request — fewer than asked is allowed, never more (core). */
export const WapGrantInput = z
  .object({ requestId: Uuid, granted: passCount("The number granted") })
  .strict();
export type WapGrantInput = z.infer<typeof WapGrantInput>;

export const WapDeclineInput = z.object({ requestId: Uuid }).strict();
export type WapDeclineInput = z.infer<typeof WapDeclineInput>;

export const WapListApproveInput = z.object({ registrationId: Uuid }).strict();
export type WapListApproveInput = z.infer<typeof WapListApproveInput>;

/** Return a list: the note is REQUIRED — the project's leads read it. */
export const WapListReturnInput = z
  .object({
    registrationId: Uuid,
    note: z
      .string()
      .trim()
      .min(1, "Write a note so the project knows what to change.")
      .max(
        WAP_RETURN_NOTE_MAX,
        `Keep the note under ${WAP_RETURN_NOTE_MAX} characters.`,
      ),
  })
  .strict();
export type WapListReturnInput = z.infer<typeof WapListReturnInput>;

/** Open or close WAP requests for an edition. */
export const WapWindowInput = z
  .object({ editionId: Uuid, action: z.enum(["open", "close"]) })
  .strict();
export type WapWindowInput = z.infer<typeof WapWindowInput>;

// --- Stored shapes -------------------------------------------------------

/**
 * One pass as the org APPROVED it — an entry of
 * `registrations.wap_list_approved_snapshot`. Ids and effective values only,
 * never a name (a copied name would outlive a rename or an account
 * sanitisation). `build`/`strike` null = the member had not said.
 */
export const WapApprovedPass = z.object({
  membershipId: Uuid,
  userId: Uuid,
  arrivalDate: z.string().nullable(),
  departureDate: z.string().nullable(),
  build: z.boolean().nullable(),
  strike: z.boolean().nullable(),
});
export type WapApprovedPass = z.infer<typeof WapApprovedPass>;
