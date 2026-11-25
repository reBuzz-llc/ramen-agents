// Since an Approve could be tied to a login but not to a session, each signed-in press that
// carries consequences is recorded with a hash of its session and that session's sign-in time, so a press can later be tied to the
// same session's other presses. No cookie or token is kept. The value is a hash of the session's stored hash, so it cannot be used to
// look a session up by its key. No page or /v1 route returns it. A failed record never fails the press; it is logged.
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { sha256 } from "./crypto";
import type { Db } from "./db";
import { authSessions, sessionPresses } from "./db/schema";
import { COOKIE } from "./session";

export type PressAction = "owner.approve" | "owner.withdraw" | "owner.clear" | "sample.approve" | "sample.request" | "sample.photo_full" | "sample.photo_dish" | "sample.photo_restore";
export type PressRow = "owner_ask" | "billing_bench" | "sample" | "sample_photo";

/** The session's value in the press log, from the id hash auth_sessions keeps. */
export const pressHash = (idHash: string) => sha256(`press:${idHash}`);

/** The one log line: time, action, row and session hash; no person. */
export const pressLine = (at: Date, action: PressAction, row: string, session: string | null) => `peek press ${JSON.stringify({ at: at.toISOString(), action, row, session })}`;

/** This request's session, as the press log writes it; null with no live session. */
export async function pressSession(d: Db): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const idHash = sha256(token);
  const [s] = await d.select({ at: authSessions.createdAt }).from(authSessions).where(eq(authSessions.idHash, idHash));
  return s ? pressHash(idHash) : null;
}

/** Has this person, in this session, already done this to this row? */
export async function pressedInSession(d: Db, who: { tenantId: string; userId: string }, action: PressAction, rowId: string, session: string): Promise<boolean> {
  const [r] = await d.select({ id: sessionPresses.id }).from(sessionPresses).where(and(eq(sessionPresses.tenantId, who.tenantId), eq(sessionPresses.userId, who.userId), eq(sessionPresses.action, action), eq(sessionPresses.rowId, rowId), eq(sessionPresses.sessionHash, session))).limit(1);
  return !!r;
}

export async function recordPress(d: Db, who: { tenantId: string; userId: string }, action: PressAction, rowKind: PressRow, rowId: string, now = new Date()): Promise<void> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    const idHash = token ? sha256(token) : "";
    const [s] = idHash ? await d.select({ at: authSessions.createdAt }).from(authSessions).where(eq(authSessions.idHash, idHash)) : [];
    const sessionHash = s ? pressHash(idHash) : null;
    await d.insert(sessionPresses).values({ tenantId: who.tenantId, userId: who.userId, action, rowKind, rowId, sessionHash, sessionAt: s?.at ?? null, at: now });
    console.log(pressLine(now, action, rowId, sessionHash));
  } catch (err) {
    console.error(`peek press not recorded: ${action} ${rowId} ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
  }
}
