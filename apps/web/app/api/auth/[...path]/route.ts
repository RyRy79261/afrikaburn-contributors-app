import { auth } from "@/lib/neon-auth";

// Catch-all that proxies Neon Auth (Better Auth)'s API surface: sign-in,
// sign-up, session, OAuth callbacks, etc. No-ops gracefully without env — the
// handler is constructed against placeholder config and only fails when an
// actual request reaches the (unconfigured) upstream auth server.
export const { GET, POST } = auth.handler();
