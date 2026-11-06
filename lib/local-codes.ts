// Sign-in codes: the portal on the owner's own machine during an outage, reached over a tunnel (a Cloudflare quick
// tunnel, say), cannot use Neon Auth, and the development sign-in (an email, nothing else) must never face the internet.
// So the owner issues each person a one-time code on Settings → People (or the first one for themselves with
// scripts/local-code.mjs on that machine); the person signs in with their email and that code and gets an ordinary
// session of the portal. Codes are 10 characters from an alphabet without look-alikes, shown once, kept as a SHA-256, valid 14 days;
// issuing a new code revokes the older ones; five wrong tries per email in 15 minutes lock that email for the rest of them.
import { randomInt } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sha256 } from "./crypto";
import type { Db } from "./db";
import { localCodes, users } from "./db/schema";

export const CODE_DAYS = 14;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const TRIES = 5;
const WINDOW_MS = 15 * 60_000;

/** Code sign-in is on: the portal runs on the owner's machine (PEEK_LOCAL_MODE=1), or on Vercel in outage mode
 *  (PEEK_OUTAGE_SIGNIN=1: the database rebuilt elsewhere while the hosted sign-in is out).
 *  Either way these codes are the sign-in, with the same limits, and Neon Auth is not called. */
export const localMode = () => process.env.PEEK_LOCAL_MODE === "1" || process.env.PEEK_OUTAGE_SIGNIN === "1";

/** "ABCD-EFGH-JK": the shape a person types; spaces, dashes and case do not matter when checked. */
export function newCode(): string {
  const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
export const normCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const codeHash = (code: string) => sha256(`local-code:${normCode(code)}`);

/** A new code for one person of the company; the older ones stop working. Returns the code, to be shown once. */
export async function issueCode(db: Db, tenantId: string, userId: string, by: string, now = new Date()): Promise<{ ok: true; code: string; expiresAt: Date } | { ok: false; error: string }> {
  const [u] = await db.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  if (!u || !u.active) return { ok: false, error: "No such person in this company." };
  const code = newCode();
  const expiresAt = new Date(now.getTime() + CODE_DAYS * 86400e3);
  await db.transaction(async (tx) => {
    await tx.update(localCodes).set({ revokedAt: now }).where(and(eq(localCodes.userId, userId), isNull(localCodes.revokedAt)));
    await tx.insert(localCodes).values({ tenantId, userId, codeHash: codeHash(code), issuedBy: by.slice(0, 80), expiresAt });
  });
  return { ok: true, code, expiresAt };
}

const tries = new Map<string, { n: number; since: number }>();

/** The person an email and a code sign in, or why not. Wrong tries are counted per email (this one server's memory). */
export async function checkCode(db: Db, email: string, code: string, now = Date.now()): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const key = email.trim().toLowerCase();
  const t = tries.get(key);
  if (t && now - t.since < WINDOW_MS && t.n >= TRIES) return { ok: false, error: "Too many wrong codes for this email. Wait 15 minutes, or ask the owner for a new code." };
  const wrong = () => {
    const cur = t && now - t.since < WINDOW_MS ? t : { n: 0, since: now };
    tries.set(key, { n: cur.n + 1, since: cur.since });
    return { ok: false as const, error: "That email and code do not match a live code. Codes last 14 days; the owner can issue a new one." };
  };
  if (!key || normCode(code).length !== 10) return wrong();
  const [row] = await db
    .select({ id: localCodes.id, userId: localCodes.userId })
    .from(localCodes)
    .innerJoin(users, eq(users.id, localCodes.userId))
    .where(and(eq(localCodes.codeHash, codeHash(code)), isNull(localCodes.revokedAt), gt(localCodes.expiresAt, new Date(now)), eq(users.active, true), eq(users.email, key)));
  if (!row) return wrong();
  tries.delete(key);
  await db.update(localCodes).set({ lastUsedAt: new Date(now) }).where(eq(localCodes.id, row.id));
  return { ok: true, userId: row.userId };
}

/** For the tests: forget the wrong tries. */
export const resetTries = () => tries.clear();
