import { z } from "zod";

/**
 * Payment tracking status (`payments.status`). The platform NEVER processes
 * money — it records a human-readable reference + status only ("we track,
 * AfrikaBurn collects").
 *
 * Keep in sync with `paymentStatusEnum` in @quagga/db schema.ts.
 */
export const PaymentStatus = z.enum(["pending", "reconciled", "waived"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/**
 * Polymorphic subject a payment reference attaches to (`payments.subject_type`,
 * a string key resolved to a row via `payments.subject_id`). Kept as an open
 * string union so new fee sources land without a schema change.
 */
export const PaymentSubjectType = z.enum([
  "registration",
  "group",
  "membership",
]);
export type PaymentSubjectType = z.infer<typeof PaymentSubjectType>;

/** Default currency for payment references. */
export const DEFAULT_CURRENCY = "ZAR";
