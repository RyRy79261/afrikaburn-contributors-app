"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/**
 * Neon Auth (Better Auth) client instance. Same-origin fetches to /api/auth/*
 * — no base URL needed. Used by the sign-in views and the console sign-out
 * button.
 */
export const authClient = createAuthClient();
