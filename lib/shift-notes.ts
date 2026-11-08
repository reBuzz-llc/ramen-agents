// "What are you working on": one-line notes a person posts while clocked in ("switched to the Brooklyn list", "on a call
// with a client"). Each lands on the shift running at that moment; posting never changes the shift. The whole company
// sees them (the owner's intent: visibility inside the organisation). Text only, 280 characters.
import { and, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { cadenceFor, liveUpdate } from "./cadence";
import { projects, shiftNotes, shifts, users, type TenantSettings } from "./db/schema";
import { GENERAL } from "./project-picker";
import { displayName } from "./display-name";

export const NOTE_MAX = 280;
export const cleanNote = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);

/** The same text on the same shift within this long is one note (Enter pressed again, a double click, a retry). */
export const SAME_NOTE_MS = 60_000;

/** Post a note on the person's open shift. Refused when they are not clocked in. Repeats make no new row: the same
 *  `clientKey` (the submission's Idempotency-Key), or the same text on the same shift within a minute, returns the note
 *  already there. The check and the insert run under a lock on the shift, so four submits at once still make one. */
export async function postNote(db: Db, tenantId: string, userId: string, raw: unknown, at = new Date(), clientKey?: string | null) {
  const text = cleanNote(raw);
  if (!text) return { ok: false as const, reason: "write something first" };
  const key = clientKey && /^[A-Za-z0-9-]{8,64}$/.test(clientKey) ? clientKey : null;
  return db.transaction(async (tx) => {
    const [open] = await tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)));
    if (!open) return { ok: false as const, reason: "clock in to post what you are working on" };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${open.id}))`);
    const [same] = await tx
      .select()
      .from(shiftNotes)
      .where(
        and(
          eq(shiftNotes.userId, userId),
          key
            ? or(eq(shiftNotes.clientKey, key), and(eq(shiftNotes.shiftId, open.id), eq(shiftNotes.text, text), gte(shiftNotes.at, new Date(at.getTime() - SAME_NOTE_MS))))
            : and(eq(shiftNotes.shiftId, open.id), eq(shiftNotes.text, text), gte(shiftNotes.at, new Date(at.getTime() - SAME_NOTE_MS))),
        ),
      )
      .limit(1);
    if (same) return { ok: true as const, note: same, repeated: true };
    const [n] = await tx.insert(shiftNotes).values({ tenantId, userId, shiftId: open.id, at, text, clientKey: key }).returning();
    return { ok: true as const, note: n, repeated: false };
  });
}

/** Delete a note: your own within ten minutes of posting it; the owner or a manager, anyone's at any time. */
export const OWN_DELETE_MS = 10 * 60_000;
export async function deleteNote(db: Db, tenantId: string, by: { userId: string; role: string }, noteId: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) return { ok: false as const, reason: "not a note" };
  const [n] = await db.select().from(shiftNotes).where(and(eq(shiftNotes.tenantId, tenantId), eq(shiftNotes.id, noteId)));
  if (!n) return { ok: false as const, reason: "that note is gone already" };
  const lead = by.role === "owner" || by.role === "manager";
  if (!lead && (n.userId !== by.userId || now.getTime() - n.at.getTime() > OWN_DELETE_MS)) {
    return { ok: false as const, reason: "you can delete your own notes for ten minutes after posting; ask a manager after that" };
  }
  await db.delete(shiftNotes).where(and(eq(shiftNotes.tenantId, tenantId), eq(shiftNotes.id, noteId)));
  return { ok: true as const };
}

export type Note = { id?: string; userId?: string; shiftId: string; at: Date; text: string };

/** The notes on some shifts, oldest first. */
export async function notesFor(db: Db, tenantId: string, shiftIds: string[]): Promise<Note[]> {
  if (!shiftIds.length) return [];
  return db
    .select({ shiftId: shiftNotes.shiftId, at: shiftNotes.at, text: shiftNotes.text })
    .from(shiftNotes)
    .where(and(eq(shiftNotes.tenantId, tenantId), inArray(shiftNotes.shiftId, shiftIds)))
    .orderBy(shiftNotes.at);
}

/** A person's notes since a moment (their day), oldest first: read alongside the day's shifts, not after them. */
export async function notesSince(db: Db, tenantId: string, userId: string, since: Date): Promise<Note[]> {
  return db
    .select({ id: shiftNotes.id, userId: shiftNotes.userId, shiftId: shiftNotes.shiftId, at: shiftNotes.at, text: shiftNotes.text })
    .from(shiftNotes)
    .where(and(eq(shiftNotes.tenantId, tenantId), eq(shiftNotes.userId, userId), gte(shiftNotes.at, since)))
    .orderBy(shiftNotes.at);
}

/** The person's latest note per project (null key is General), to prefill "What will you work on?". */
export async function lastNotes(db: Db, tenantId: string, userId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ projectId: shifts.projectId, text: shiftNotes.text, at: shiftNotes.at })
    .from(shiftNotes)
    .innerJoin(shifts, eq(shifts.id, shiftNotes.shiftId))
    .where(and(eq(shiftNotes.tenantId, tenantId), eq(shiftNotes.userId, userId)))
    .orderBy(desc(shiftNotes.at))
    .limit(200);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.projectId ?? ""] ??= r.text;
  return out;
}

export type NowRow = { userId: string; name: string; project: string; since: Date; note: string | null; noteAt: Date | null; overdueSince: Date | null };

/** Who is clocked in right now, on which project, since when, and their latest note: the home page's "Team now". */
export async function teamNow(db: Db, tenantId: string, settings: TenantSettings = {}, now = new Date()): Promise<NowRow[]> {
  const openShifts = and(eq(shifts.tenantId, tenantId), isNull(shifts.endedAt));
  // Two queries side by side: the open shifts, and the notes on them (found by a subquery, not by waiting for the first).
  const [open, notes] = await Promise.all([
    db
      .select({ shiftId: shifts.id, userId: users.id, name: users.name, email: users.email, project: projects.name, cadenceHistory: projects.cadenceHistory, since: shifts.startedAt })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .leftJoin(projects, eq(projects.id, shifts.projectId))
      .where(openShifts),
    db
      .select({ shiftId: shiftNotes.shiftId, at: shiftNotes.at, text: shiftNotes.text })
      .from(shiftNotes)
      .where(and(eq(shiftNotes.tenantId, tenantId), inArray(shiftNotes.shiftId, db.select({ id: shifts.id }).from(shifts).where(openShifts))))
      .orderBy(shiftNotes.at),
  ]);
  return open
    .map((o) => {
      const own = notes.filter((n) => n.shiftId === o.shiftId);
      const last = own.at(-1);
      // Overdue for an update on a project with a cadence (a reminder, shown to the owner and managers).
      const live = liveUpdate({ startedAt: o.since, endedAt: null }, own, cadenceFor(o.project ? { cadenceHistory: o.cadenceHistory } : null, settings), now);
      return { userId: o.userId, name: displayName(o.name, o.email), project: o.project ?? GENERAL, since: o.since, note: last?.text ?? null, noteAt: last?.at ?? null, overdueSince: live.overdueSince };
    })
    .sort((a, b) => (b.noteAt ?? b.since).getTime() - (a.noteAt ?? a.since).getTime());
}

export type LogLine = { at: Date; name: string; text: string };

/** A project's day as a client-readable log: every "Now doing…" note on that project's shifts in the day, in order, and
 *  the hours worked on it. `projectId` null is General. Text only; no pay, no screenshots. */
export async function projectLog(db: Db, tenantId: string, projectId: string | null, from: Date, to: Date) {
  const onProject = projectId ? eq(shifts.projectId, projectId) : isNull(shifts.projectId);
  const [lines, worked] = await Promise.all([
    db
      .select({ at: shiftNotes.at, name: users.name, email: users.email, text: shiftNotes.text })
      .from(shiftNotes)
      .innerJoin(shifts, eq(shifts.id, shiftNotes.shiftId))
      .innerJoin(users, eq(users.id, shiftNotes.userId))
      .where(and(eq(shiftNotes.tenantId, tenantId), onProject, gte(shiftNotes.at, from), lt(shiftNotes.at, to)))
      .orderBy(shiftNotes.at),
    db
      .select({ startedAt: shifts.startedAt, endedAt: shifts.endedAt })
      .from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), onProject, lt(shifts.startedAt, to), or(isNull(shifts.endedAt), gt(shifts.endedAt, from)))),
  ]);
  // Minutes inside the day only (a shift across midnight counts on both days, each for its own part).
  const now = new Date();
  const minutes = worked.reduce((t, s) => {
    const a = Math.max(s.startedAt.getTime(), from.getTime());
    const b = Math.min((s.endedAt ?? now).getTime(), to.getTime(), now.getTime());
    return t + Math.max(0, Math.round((b - a) / 60000));
  }, 0);
  return { lines: lines.map((l) => ({ at: l.at, name: displayName(l.name, l.email), text: l.text })) as LogLine[], minutes };
}
