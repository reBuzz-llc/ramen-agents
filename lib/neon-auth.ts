// Neon Auth (managed Better Auth) on the linked Neon branch: the sign-in. Users and sessions live in Neon's `neon_auth` schema; ramen-agents maps each signed-in email to its
// own users row (company and role). Null when NEON_AUTH_BASE_URL is not set (tests, or before `neon env pull`).
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { cache } from "react";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const secret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();

export const neonAuth = baseUrl && secret ? createNeonAuth({ baseUrl, cookies: { secret } }) : null;

/** The person signed in through Neon Auth (email and name), or null. Cached for the request. */
export const neonUser = cache(async (): Promise<{ email: string; name: string } | null> => {
  if (!neonAuth) return null;
  try {
    const { data } = await neonAuth.getSession();
    const email = data?.user?.email?.toLowerCase();
    return email ? { email, name: data?.user?.name ?? "" } : null;
  } catch {
    return null;
  }
});
