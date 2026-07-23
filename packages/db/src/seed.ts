/**
 * Idempotent seed script — STUB. Wave 2 (demo dressing) fills this in.
 *
 * Planned per docs/build-spec.md §Seeds (all obviously fictional, no real
 * people — e.g. `dusty.prototype@example.com`):
 *   - org group "AfrikaBurn" + edition AfrikaBurn 2027 (2027-04-26 → 2027-05-02)
 *   - camps: Mad Hatters (approved registration), Camp 404 (submitted/under
 *     review), + 6 fictional camps in varied states (draft, changes_requested,
 *     free camps with no registration)
 *   - suppliers imported from the AB public sheet JSON snapshot (offline)
 *   - a few payment references in mixed states
 *
 * Run via `pnpm --filter @quagga/db db:seed` once `DATABASE_URL` is set. This
 * script is NEVER part of any build step and must not run at import time.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[seed] DATABASE_URL is not set — nothing to seed. Set it in .env first.",
    );
    process.exitCode = 1;
    return;
  }

  // TODO(wave-2): create the pooled driver, then upsert the org group, the
  // 2027 edition, the seed camps + registrations, suppliers, and payment
  // references — all idempotently (INSERT ... ON CONFLICT DO NOTHING / upsert).
  console.log("[seed] Stub — no seed data defined yet (wave 2 fills this in).");
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exitCode = 1;
});
