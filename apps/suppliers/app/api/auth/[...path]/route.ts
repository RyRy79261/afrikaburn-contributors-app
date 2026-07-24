import { auth } from "@/lib/neon-auth";

// Catch-all that proxies Neon Auth (Better Auth)'s API surface: sign-in,
// session, OAuth callbacks, sign-out, etc. Shares the same cookie secret as
// apps/web and apps/org, so the portal recognises a session established there —
// which is how email overlap links a burner account to a supplier row. No-ops
// gracefully without env; only fails when a request reaches the unconfigured
// upstream auth server.
export const { GET, POST } = auth.handler();
