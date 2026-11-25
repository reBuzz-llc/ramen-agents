// Who is signed in: Peek's own session (a random id in an HttpOnly cookie whose SHA-256 alone is stored), made by Peek's
// own Google sign-in or, never in a production build,
// the development sign-in (TEAMS_DEV_LOGIN=1). Neon Auth was removed.
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db as getDb } from "./db";
import { principalById, sessionUser, type Me } from "./principal";
import { ensureLocalOwner, localRequest, signInMode } from "./local-mode";
import { hintFor, rememberHint } from "./session-hint";

export { sessionUser, type Me };

export { COOKIE, createSession, endSession } from "./session";
import { COOKIE } from "./session";

/** The signed-in person, from Peek's own session cookie. Cached for the request, so the layout and the page share one
 *  lookup. */
export const me = cache(async (): Promise<Me | null> => {
  if (signInMode() === "off") return localMe();
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const who = await sessionUser(await getDb(), token);
  rememberHint(token, who);
  return who;
});

/** Sign-in off (lib/local-mode.ts): the one local owner, for a request made on this computer straight to Peek; anything
 *  else is nobody, so pages send it to the sign-in page and the API answers 401. */
async function localMe(): Promise<Me | null> {
  if (!localRequest(await headers()).ok) return null;
  const db = await getDb();
  const g = globalThis as { __peekLocalOwner?: string };
  g.__peekLocalOwner ??= await ensureLocalOwner(db);
  const who = await principalById(db, g.__peekLocalOwner);
  if (who) return who;
  g.__peekLocalOwner = await ensureLocalOwner(db);
  return principalById(db, g.__peekLocalOwner);
}

/** Whose reads may start while the check above runs (lib/session-hint.ts). Never a substitute for the check. */
export const sessionHint = async () => hintFor((await cookies()).get(COOKIE)?.value);

/** Development sign-in is available only outside production and only when the env asks for it. */
export const devLoginEnabled = () => process.env.NODE_ENV !== "production" && process.env.TEAMS_DEV_LOGIN === "1" && signInMode() !== "off";
