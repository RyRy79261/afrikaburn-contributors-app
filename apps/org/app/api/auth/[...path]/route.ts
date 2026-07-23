import { auth } from "@/lib/neon-auth";

// Catch-all that proxies Neon Auth (Better Auth)'s API surface: sign-in,
// session, OAuth callbacks, sign-out, etc. Shares the same cookie secret as
// apps/web, so the console recognises a session established there. No-ops
// gracefully without env — only fails when a request reaches the unconfigured
// upstream auth server.
export const { GET, POST } = auth.handler();
