"use client";
// The browser side of Neon Auth: talks to this app's own /api/auth proxy (no arguments, per Neon's Next.js guide).
import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();
