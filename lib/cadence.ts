// Update cadence: while a person
// is clocked in on a project with a cadence, they post a "Now doing…" note once per window. Nothing is enforced or
// deducted; it is a reminder and a visibility record ("4 of 5 updates"). Pure functions, tested.
//
// The windows run back to back from the shift's start: each is as long as the cadence in force when it begins, so a
// cadence changed mid-shift applies from the next window (the one under way keeps its length). A window is met when a
// note was posted in it. Only windows that have ended count: one still running is neither expected nor missed.
import type { TenantSettings } from "./db/schema";

/** A cadence from a moment on: minutes between updates; 0 is none; null (on a project) means the company default. */
export type CadenceEntry = { from: string; minutes: number | null };
export const CADENCES = [
  { minutes: 0, label: "No updates" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Hourly" },
  { minutes: 120, label: "Every 2 hours" },
] as const;
export const ROUNDINGS = [0, 5, 15] as const;
export type Rounding = (typeof ROUNDINGS)[number];

export type UpdatesSettings = NonNullable<TenantSettings["updates"]>;

/** The entry in force at `t`: the newest one that began on or before it. */
export function entryAt(history: CadenceEntry[] | undefined, t: Date): CadenceEntry | undefined {
  let found: CadenceEntry | undefined;
  for (const e of history ?? []) if (new Date(e.from).getTime() <= t.getTime() && (!found || e.from >= found.from)) found = e;
  return found;
}

/** The cadence for shifts on a project (null project is General) at any moment: the project's own, else the company's
 *  default, else none. */
export function cadenceFor(project: { cadenceHistory?: CadenceEntry[] | null } | null, settings: TenantSettings): (t: Date) => number {
  const updates = settings.updates;
  return (t) => {
    const own = entryAt(project?.cadenceHistory ?? undefined, t);
    if (own && own.minutes !== null) return own.minutes;
    return entryAt(updates?.defaultHistory, t)?.minutes ?? 0;
  };
}

/** A change from now on: appended to a history, replacing any entry from the same minute. */
export function withChange(history: CadenceEntry[] | undefined, minutes: number | null, at = new Date()): CadenceEntry[] {
  const from = new Date(Math.floor(at.getTime() / 60000) * 60000).toISOString();
  return [...(history ?? []).filter((e) => e.from !== from), { from, minutes }].sort((a, b) => a.from.localeCompare(b.from));
}

export type Window = { from: Date; to: Date; met: boolean };

// With no cadence in force, look again this often, so one switched on mid-shift starts within it.
const IDLE_STEP_MIN = 15;

/** The update windows of one shift that have ended by min(shift end, now), and how many had a note. */
export function updateWindows(
  shift: { startedAt: Date; endedAt: Date | null },
  notes: { at: Date }[],
  cadenceAt: (t: Date) => number,
  now = new Date(),
): { expected: number; met: number; windows: Window[] } {
  const end = Math.min((shift.endedAt ?? now).getTime(), now.getTime());
  const windows: Window[] = [];
  let b = shift.startedAt.getTime();
  for (let guard = 0; guard < 2000 && b < end; guard++) {
    const c = cadenceAt(new Date(b));
    if (!c) {
      b += IDLE_STEP_MIN * 60000;
      continue;
    }
    const to = b + c * 60000;
    if (to > end) break;
    const from = b;
    windows.push({ from: new Date(from), to: new Date(to), met: notes.some((n) => n.at.getTime() >= from && n.at.getTime() < to) });
    b = to;
  }
  return { expected: windows.length, met: windows.filter((w) => w.met).length, windows };
}

export type LiveUpdate = {
  cadence: number; // minutes, 0 = none
  dueAt: Date | null; // the end of the window under way
  postedThisWindow: boolean;
  overdueSince: Date | null; // the last window ended without a note, and none since
};

/** For the clock and Team now: the window under way, whether it has a note, and whether an update is overdue. */
export function liveUpdate(shift: { startedAt: Date; endedAt: Date | null }, notes: { at: Date }[], cadenceAt: (t: Date) => number, now = new Date()): LiveUpdate {
  const { windows } = updateWindows(shift, notes, cadenceAt, now);
  const start = windows.length ? windows[windows.length - 1].to : shift.startedAt;
  const cadence = cadenceAt(start);
  if (!cadence || shift.endedAt) return { cadence, dueAt: null, postedThisWindow: false, overdueSince: null };
  const dueAt = new Date(start.getTime() + cadence * 60000);
  const postedThisWindow = notes.some((n) => n.at.getTime() >= start.getTime() && n.at.getTime() <= now.getTime());
  const last = windows.at(-1);
  return { cadence, dueAt, postedThisWindow, overdueSince: last && !last.met && !postedThisWindow ? last.to : null };
}

/** A shift's times rounded for paid and total figures: start down, end up, to the step (0 = as they are). Raw times
 *  stay in the database, on the clock and on notes. */
export function roundShift(startedAt: Date, endedAt: Date, step: Rounding | number): { startedAt: Date; endedAt: Date } {
  if (!step) return { startedAt, endedAt };
  const ms = step * 60000;
  return { startedAt: new Date(Math.floor(startedAt.getTime() / ms) * ms), endedAt: new Date(Math.ceil(endedAt.getTime() / ms) * ms) };
}
