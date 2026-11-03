// Who is signed in. Neon Auth (managed Better Auth on the Neon branch) does the signing in: email and password, or
// Google; its session is mapped by email to a users row here (company, role). A development session (TEAMS_DEV_LOGIN=1,
// never in a production build) is a random id in an HttpOnly cookie whose SHA-256 alone is stored.
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { newToken, sha256 } from "./crypto";
import { db as getDb, type Db } from "./db";
import { authSessions } from "./db/schema";
import { userForSignIn } from "./bootstrap";
import { neonUser } from "./neon-auth";
import { principalByEmail, sessionUser, type Me } from "./principal";
import { markSignedIn } from "./team";

export { sessionUser, type Me };

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

/** The signed-in person: a development session on this machine, else the Neon Auth session mapped to a users row by
 *  email. The first Neon Auth sign-in on an empty database creates the company and makes that person its owner.
 *  Cached for the request, so the layout and the page share one lookup. */
export const me = cache(async (): Promise<Me | null> => {
  const jar = await cookies();
  const d = await getDb();
  const dev = await sessionUser(d, jar.get(COOKIE)?.value);
  if (dev) return dev;
  const neon = await neonUser();
  if (!neon) return null;
  const found = await principalByEmail(d, neon.email);
  if (found) {
    // A person added in Settings → People signing in for the first time: stamped once, so the list stops saying
    // "invited, not signed in yet".
    if (!found.firstSignedInAt) await markSignedIn(d, found.userId);
    return found;
  }
  // Not here yet: the first sign-in on an empty database makes the company (rare, so the extra queries are fine).
  const r = await userForSignIn(d, neon.email, neon.name);
  if (!r.ok) return null;
  await markSignedIn(d, r.user.id);
  return principalByEmail(d, r.user.email);
});

/** Signed in with Neon Auth, but not a member of any company here. */
export async function signedInWithoutAccess(): Promise<string | null> {
  const neon = await neonUser();
  if (!neon) return null;
  return (await me()) ? null : neon.email;
}

/** Development sign-in is available only outside production and only when the env asks for it. */
export const devLoginEnabled = () => process.env.NODE_ENV !== "production" && process.env.TEAMS_DEV_LOGIN === "1";
