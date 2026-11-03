// A person's day: their shifts (clock-in to clock-out), the total worked, and the gaps between shifts that they may
// annotate. Pure functions; times are Date objects, and "now" closes an open shift for display only.

export type Shift = { id: string; startedAt: Date; endedAt: Date | null; note: string; projectId?: string | null };
export type Gap = { from: Date; to: Date; minutes: number; note: string };
export type Day = { shifts: (Shift & { minutes: number; open: boolean })[]; workedMinutes: number; gaps: Gap[] };

const minutes = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/** Only one shift may be open: clocking in while one is open is refused, clocking out with none is refused. */
export function canClockIn(shifts: Shift[]): boolean {
  return !shifts.some((s) => s.endedAt === null);
}
export function openShift(shifts: Shift[]): Shift | undefined {
  return shifts.find((s) => s.endedAt === null);
}

export function day(shifts: Shift[], notes: { fromAt: Date; toAt: Date; note: string }[] = [], now = new Date(), minGap = 15): Day {
  const sorted = [...shifts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const rows = sorted.map((s) => ({ ...s, open: s.endedAt === null, minutes: minutes(s.startedAt, s.endedAt ?? now) }));
  const gaps: Gap[] = [];
  for (let i = 1; i < rows.length; i++) {
    const from = rows[i - 1].endedAt;
    const to = rows[i].startedAt;
    if (!from || minutes(from, to) < minGap) continue;
    const n = notes.find((x) => x.fromAt.getTime() === from.getTime() && x.toAt.getTime() === to.getTime());
    gaps.push({ from, to, minutes: minutes(from, to), note: n?.note ?? "" });
  }
  return { shifts: rows, workedMinutes: rows.reduce((t, r) => t + r.minutes, 0), gaps };
}

export const hhmm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

// ---- hours by project -----------------------------------------------------------------------------------------------

export type ProjectShift = { startedAt: Date; endedAt: Date | null; projectId: string | null };

/** Minutes worked per project, keyed by project id; null is General. An open shift counts up to `now`. Rounding to
 *  hours happens once, where the minutes are shown or paid. */
export function minutesByProject(shifts: ProjectShift[], now = new Date()): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const s of shifts) m.set(s.projectId ?? null, (m.get(s.projectId ?? null) ?? 0) + minutes(s.startedAt, s.endedAt ?? now));
  return m;
}
