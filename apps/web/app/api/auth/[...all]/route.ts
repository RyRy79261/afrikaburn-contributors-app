import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@quagga/auth";

// Self-hosted Better Auth mounted in-process for this app (auth-platform-spec
// §2.1). The shared @quagga/auth config points its drizzleAdapter at our own
// Neon DB, so this handler serves the full auth surface — sign-in/up, session,
// OAuth callbacks, password reset, verification, sign-out — at /api/auth/*.
//
// Env-less boot (AGENTS.md rule 4): @quagga/auth constructs with a build
// placeholder secret, so this import never throws; requests only mint real,
// cross-app-valid sessions once BETTER_AUTH_SECRET is set on all three projects.
export const { GET, POST } = toNextJsHandler(auth);
