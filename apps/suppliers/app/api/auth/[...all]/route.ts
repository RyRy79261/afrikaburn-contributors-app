import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@quagga/auth";

// Self-hosted Better Auth mounted in-process for the supplier portal
// (auth-platform-spec §2.1). Same shared @quagga/auth config and Neon DB as
// apps/web and apps/org, so the portal recognises a session established on any
// of them — which is how email overlap links a burner account to a supplier row.
//
// Env-less boot (AGENTS.md rule 4): the import never throws; requests only work
// once BETTER_AUTH_SECRET is present.
export const { GET, POST } = toNextJsHandler(auth);
