// The portal's own sessions (the development sign-in, the local and outage codes, the portal's own Google sign-in): a random id in an
// HttpOnly cookie, only its SHA-256 stored. Kept apart from lib/auth.ts so a sign-in route needs no Neon Auth at all.
import { eq } from "drizzle-orm";
import { newToken, sha256 } from "./crypto";
import type { Db } from "./db";
import { authSessions } from "./db/schema";

export const COOKIE = "pp_session";
const DAYS = 30;

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + DAYS * 86400e3);
  await db.insert(authSessions).values({ idHash: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function endSession(db: Db, token: string | undefined) {
  if (token) await db.delete(authSessions).where(eq(authSessions.idHash, sha256(token)));
}
