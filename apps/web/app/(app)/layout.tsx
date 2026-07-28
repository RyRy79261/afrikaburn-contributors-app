import { AppShell } from "@/components/app-shell";
import { viewerIsGated } from "@/lib/session";

/**
 * Load-bearing, not boilerplate. Every helper in this app degrades env-lessly —
 * `getAuthenticatedUser` returns null WITHOUT touching `headers()` when
 * `BETTER_AUTH_SECRET` is unset (the env-less boot law, AGENTS.md rule 4). So an
 * env-less build has no dynamic API to trip on and would happily prerender this
 * shell with its SIGNED-OUT nav, which a later-configured deployment would then
 * serve to everyone. `force-dynamic` is what stops that. It is why the blanket
 * across this codebase is mostly correct and was not lifted.
 */
export const dynamic = "force-dynamic";

/**
 * The signed-in participant shell, hoisted out of the pages and into a LAYOUT.
 *
 * It used to live inside each of the 20-odd pages, which meant every navigation
 * re-ran the shell's session read, edition lookup and unread-count query, re-sent
 * the whole header down the wire, and — worst of it — tore the chrome out of the
 * DOM so the root `loading.tsx` could replace the entire screen with a skeleton.
 * The header visibly blinked on every click.
 *
 * As a layout it renders once. React keeps it mounted across client-side
 * navigations inside this group, so the header, nav and edition banner stay put
 * and only the page body swaps — which is what makes a route change read as
 * instant even while the destination is still being fetched. The
 * `loading.tsx` boundaries below now render INSIDE this chrome for the same
 * reason.
 *
 * `/` (marketing), `/auth/*` and `/join/*` deliberately sit outside the group:
 * the first two draw their own chrome, and the invite landing page needs
 * `AppShell minimalNav` — a stranger on a one-purpose page is offered that one
 * purpose, not the whole app's navigation.
 */
export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // A viewer held by the hard gate gets brand + sign-out and nothing else. The
  // gate page cannot do this for itself now that the shell is a layout above
  // it — it drew its own stripped header and got the full nav on top. Both
  // reads behind this are request-cache()d and shared with the page's own
  // `enforceGate`, so it is free on the surfaces that matter.
  const gatedNav = await viewerIsGated();
  return <AppShell gatedNav={gatedNav}>{children}</AppShell>;
}
