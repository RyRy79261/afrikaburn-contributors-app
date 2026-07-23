import { z } from "zod";

/**
 * Supplier vetting lifecycle (`suppliers.vetting_status`).
 * - `listed`     — imported/known, not yet vetted.
 * - `registered` — vetted and onboarded by AfrikaBurn.
 * - `flagged`    — flagged for attention (concern raised).
 *
 * Keep in sync with `vettingStatusEnum` in @quagga/db schema.ts.
 */
export const VettingStatus = z.enum(["listed", "registered", "flagged"]);
export type VettingStatus = z.infer<typeof VettingStatus>;

/**
 * Where a supplier row originated (`suppliers.source`).
 * - `ab_sheet` — imported from AfrikaBurn's public Suppliers List sheet.
 * - `manual`   — hand-added in the org app.
 *
 * Keep in sync with `supplierSourceEnum` in @quagga/db schema.ts.
 */
export const SupplierSource = z.enum(["ab_sheet", "manual"]);
export type SupplierSource = z.infer<typeof SupplierSource>;

/**
 * Shape of a single supplier as parsed from the AB public sheet CSV/JSON
 * snapshot. The import parser (@quagga/core `parseSuppliersCsv`) normalises
 * rows into this. `vettingStatus` is derived from the sheet's own "Status"
 * column (e.g. "In Good Standing" → `registered`; blank → `listed`) — the org
 * app can still hand-edit it after import.
 */
export const SupplierImportRow = z.object({
  name: z.string().min(1),
  services: z.string().default(""),
  contact: z.string().default(""),
  website: z.string().default(""),
  vettingStatus: VettingStatus.default("listed"),
});
export type SupplierImportRow = z.infer<typeof SupplierImportRow>;
