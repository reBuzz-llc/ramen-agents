// A clock left running for days once reached a draft pay statement. A clock open over 14 hours is flagged, and that
// week's statement cannot be approved until the shift is closed. Nothing closes a clock by itself and nothing caps hours: the member
// closes their own (the Clock's prompt), or an owner or manager enters the real end time for them. Each such close or correction is
// recorded: who, when, and the end before and after. The member sees it on their Clock page.
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "./db";
import { shiftEdits, shifts, statements, users } from "./db/schema";
import { canSeePay } from "./rates";
import { startDayOf, weekStart } from "./week";

export const LONG_OPEN_HOURS = 14;
const HOUR = 3_600_000;

export class ClockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class StatementBlocked extends Error {}

export type LongOpen = { shiftId: string; startedAt: Date; hours: number };
export type Actor = { userId: string; name: string; role: string };
export type ShiftEdit = { shiftId: string; action: string; startedAt: string; endedAt: string; by: string; at: string };

export const isLongOpen = (startedAt: Date, now: Date) => now.getTime() - startedAt.getTime() > LONG_OPEN_HOURS * HOUR;
const hoursOpen = (startedAt: Date, now: Date) => Math.floor((now.getTime() - startedAt.getTime()) / HOUR);
export const longOpenLine = (hours: number) => `This clock has been open for ${hours} hours. Close it with the real end time before this statement can be approved.`;

/** Everyone's clocks open over 14 hours, the oldest for a person when there are two. */
export async function longOpenShifts(d: Db, tenantId: string, now = new Date()): Promise<Map<string, LongOpen>> {
  const rows = await d.select({ id: shifts.id, userId: shifts.userId, startedAt: shifts.startedAt }).from(shifts).where(and(eq(shifts.tenantId, tenantId), isNull(shifts.endedAt))).orderBy(shifts.startedAt);
  const out = new Map<string, LongOpen>();
  for (const r of rows) if (isLongOpen(r.startedAt, now) && !out.has(r.userId)) out.set(r.userId, { shiftId: r.id, startedAt: r.startedAt, hours: hoursOpen(r.startedAt, now) });
  return out;
}

/** A person's clock open over 14 hours that started inside this week: what holds that week's statement. */
export async function longOpenInWeek(d: Db, tenantId: string, userId: string, from: Date, to: Date, now = new Date()): Promise<LongOpen | null> {
  const rows = await d.select({ id: shifts.id, startedAt: shifts.startedAt }).from(shifts)
    .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt), gte(shifts.startedAt, from), lt(shifts.startedAt, to))).orderBy(shifts.startedAt);
  const r = rows.find((x) => isLongOpen(x.startedAt, now));
  return r ? { shiftId: r.id, startedAt: r.startedAt, hours: hoursOpen(r.startedAt, now) } : null;
}

/** An owner for anyone else, a manager for a member. A person's own clock is closed from their own Clock page. */
export const canFixClock = (actor: { userId: string; role: string }, member: { id: string; role: string }) =>
  actor.userId !== member.id && (actor.role === "owner" || actor.role === "manager") && canSeePay({ id: actor.userId, role: actor.role }, member);

function endFrom(raw: unknown, startedAt: Date, now: Date): Date {
  const at = typeof raw === "string" && raw ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) throw new ClockError(400, "Give the date and time the work really ended.");
  if (at > now) throw new ClockError(400, "That time has not come yet. Give the time the work really ended.");
  if (at <= startedAt) throw new ClockError(400, "The end must be after the shift started.");
  return at;
}

async function shiftFor(t: Db, tenantId: string, shiftId: string, actor: Actor) {
  if (!/^[0-9a-f-]{36}$/i.test(shiftId)) throw new ClockError(404, "No such shift.");
  const [s] = await t.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, shiftId))).for("update");
  if (!s) throw new ClockError(404, "No such shift.");
  const [member] = await t.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, s.userId)));
  if (!member || !canFixClock(actor, member)) throw new ClockError(403, "Only an owner, or a manager for a member, can change someone else's clock.");
  return s;
}

/** An owner or manager closes a member's forgotten clock at the real end time they enter. */
export async function closeClockFor(d: Db, tenantId: string, shiftId: string, rawEnd: unknown, actor: Actor, now = new Date()): Promise<void> {
  await d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const s = await shiftFor(t, tenantId, shiftId, actor);
    if (s.endedAt) throw new ClockError(409, "This clock is already closed.");
    if (!isLongOpen(s.startedAt, now)) throw new ClockError(409, `This clock has been open under ${LONG_OPEN_HOURS} hours: the person may still be working.`);
    const end = endFrom(rawEnd, s.startedAt, now);
    await t.update(shifts).set({ endedAt: end }).where(and(eq(shifts.id, s.id), isNull(shifts.endedAt)));
    await t.insert(shiftEdits).values({ tenantId, shiftId: s.id, userId: s.userId, action: "close", oldEnd: null, newEnd: end, byUser: actor.userId, byName: actor.name.slice(0, 80), byRole: actor.role, at: now });
  });
}

/** A correction, when the member says the end entered for them is wrong. Never on a week whose statement is approved. */
export async function correctClock(d: Db, tenantId: string, shiftId: string, rawEnd: unknown, actor: Actor, settings: (Parameters<typeof startDayOf>[0] & { timezone?: string | null }) | null | undefined, now = new Date()): Promise<void> {
  await d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const s = await shiftFor(t, tenantId, shiftId, actor);
    if (!s.endedAt) throw new ClockError(409, "This clock is still open: close it first.");
    const [was] = await t.select({ id: shiftEdits.id }).from(shiftEdits).where(and(eq(shiftEdits.tenantId, tenantId), eq(shiftEdits.shiftId, s.id))).limit(1);
    if (!was) throw new ClockError(409, "Only a clock closed for the member can be corrected here.");
    const week = weekStart(s.startedAt, startDayOf(settings), settings?.timezone);
    const [frozen] = await t.select({ id: statements.id }).from(statements).where(and(eq(statements.tenantId, tenantId), eq(statements.userId, s.userId), eq(statements.weekStart, week)));
    if (frozen) throw new ClockError(409, "That week's statement is approved and frozen, so this shift cannot change.");
    const end = endFrom(rawEnd, s.startedAt, now);
    if (end.getTime() === s.endedAt.getTime()) throw new ClockError(409, "That is already the end time.");
    await t.update(shifts).set({ endedAt: end }).where(eq(shifts.id, s.id));
    await t.insert(shiftEdits).values({ tenantId, shiftId: s.id, userId: s.userId, action: "correct", oldEnd: s.endedAt, newEnd: end, byUser: actor.userId, byName: actor.name.slice(0, 80), byRole: actor.role, at: now });
  });
}

/** The latest close or correction of each of a person's shifts since `since`, newest first. */
export async function shiftEditsOf(d: Db, tenantId: string, userId: string, since: Date): Promise<ShiftEdit[]> {
  const rows = await d.select({ shiftId: shiftEdits.shiftId, action: shiftEdits.action, newEnd: shiftEdits.newEnd, by: shiftEdits.byName, at: shiftEdits.at, startedAt: shifts.startedAt }).from(shiftEdits)
    .innerJoin(shifts, eq(shifts.id, shiftEdits.shiftId))
    .where(and(eq(shiftEdits.tenantId, tenantId), eq(shiftEdits.userId, userId), gte(shiftEdits.at, since))).orderBy(desc(shiftEdits.at));
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.shiftId) && !!seen.add(r.shiftId)).map((r) => ({ shiftId: r.shiftId, action: r.action, startedAt: r.startedAt.toISOString(), endedAt: r.newEnd.toISOString(), by: r.by, at: r.at.toISOString() }));
}
