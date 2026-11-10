// The live office on the Family page: the agents' world runs on the machine that runs them (the fleet's
// webapp/scripts/world-public.ts) and is reached through a tunnel address the owner pastes in Settings → Company. Each
// page load signs a link for the signed-in person, good for two hours:
// t = base64url("<exp>.<person>") + "." + base64url(HMAC-SHA256(WORLD_SHARE_SECRET, "<exp>.<person>")), exp in Unix
// seconds, as the fleet's lib/world-public.ts verifies it (a test on each side checks the same vector).
import { createHmac } from "node:crypto";

export const LINK_HOURS = 2;

export function signWorldToken(secret: string, person: string, exp: number): string {
  const payload = `${Math.floor(exp)}.${person.replace(/\s+/g, " ").trim().slice(0, 60)}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

/** The address as the owner saved it: https only, no path, query or fragment; else null. */
export function worldBase(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The frame's address for this person now, or null when no address is saved or the secret is not set. */
export function worldLink(base: string | null, secret: string | undefined, person: string, now = Date.now()): string | null {
  if (!base || !secret || secret.length < 32) return null;
  return `${base}/?t=${signWorldToken(secret, person, Math.floor(now / 1000) + LINK_HOURS * 3600)}`;
}
