// Per-person pay rates and the weekly statement built from them. Pure functions, tested
// apart from the database. Rates are history, never edited: on any day the newest rate whose effectiveFrom is on or before
// that day applies, else the company's defaults. A rate change mid-week splits the week, so each hour is paid at the rate
// in force on the day it was worked. Rates are for the owner, the person and their manager only -- never the leaderboard,
// never a teammate, never the agents.
import { cadenceFor, roundShift, updateWindows, type CadenceEntry } from "./cadence";
import type { TenantSettings } from "./db/schema";
import type { PersonWeek, Rates, Statement, StatementLine } from "./scoreboard";

export type RateRow = { effectiveFrom: string; hourly: number | null; outcomeBonus: number | null; currency: string };
export type ShiftLike = { startedAt: Date; endedAt: Date | null; projectId: string | null };
/** Minutes per project id (null = "General") for shifts: lib/timesheet.ts's minutesByProject once 0005 lands. */
export type ByProject = (shifts: ShiftLike[], now: Date) => Map<string | null, number>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The local calendar day of a moment, YYYY-MM-DD (the same clock the week's start uses). */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

/** The rates in force on `day`: the newest row on or before it, else the defaults. */
export function rateOn(history: RateRow[], defaults: Rates, day: string): Rates & { from: string | null } {
  const row = [...history].filter((r) => r.effectiveFrom <= day).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!row) return { ...defaults, from: null };
  return {
    hourly: row.hourly ?? undefined,
    outcomeBonus: row.outcomeBonus ?? undefined,
    currency: row.currency || defaults.currency || "USD",
    from: row.effectiveFrom,
  };
}

/** The week [weekStart, weekStart + 7) cut where a rate starts: [{from, to (exclusive), rates}]. */
export function periodsOf(history: RateRow[], defaults: Rates, weekStart: string) {
  const end = addDays(weekStart, 7);
  const cuts = [weekStart, ...history.map((r) => r.effectiveFrom).filter((d) => d > weekStart && d < end)].sort();
  const unique = [...new Set(cuts)];
  return unique.map((from, i) => ({ from, to: unique[i + 1] ?? end, rates: rateOn(history, defaults, from) }));
}

/** Everything under null ("General"): the stand-in until projects land on shifts; it matches minutesByProject then. */
export const allGeneral: ByProject = (shifts, now) => {
  const minutes = shifts.reduce((m, s) => m + Math.max(0, Math.round(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60000)), 0);
  return new Map<string | null, number>(minutes ? [[null, minutes]] : []);
};

/**
 * One line per project per rate period: hours x the hourly rate in force when they were worked. A shift belongs to the
 * period of the day it started (a shift across midnight into a new rate stays at the rate it began under). Minutes are
 * summed per period and rounded to hours (2 decimals) once, here.
 */
export function statementLines(shifts: ShiftLike[], history: RateRow[], defaults: Rates, weekStart: string, now: Date,
                               byProject: ByProject = allGeneral, projectNames: Map<string, string> = new Map(), step = 0): StatementLine[] {
  const lines: StatementLine[] = [];
  // Paid minutes come from rounded shifts (settings.updates.rounding); the day a shift belongs to is its raw start day.
  shifts = shifts.map((x) => {
    const r = roundShift(x.startedAt, x.endedAt ?? now, step);
    return { ...x, startedAt: dayOf(r.startedAt) === dayOf(x.startedAt) ? r.startedAt : x.startedAt, endedAt: r.endedAt };
  });
  for (const p of periodsOf(history, defaults, weekStart)) {
    const inPeriod = shifts.filter((s) => {
      const day = dayOf(s.startedAt);
      return day >= p.from && day < p.to;
    });
    for (const [projectId, minutes] of byProject(inPeriod, now)) {
      const project = projectId === null ? "General" : projectNames.get(projectId) ?? "(removed project)";   // as lib/projects.ts projectName
      const hours = round2(minutes / 60);
      const hourly = typeof p.rates.hourly === "number" ? p.rates.hourly : null;
      lines.push({ project, from: p.from, to: addDays(p.to, -1), hours, hourly, base: hourly === null ? null : round2(hours * hourly) });
    }
  }
  return lines;
}

/**
 * The statement: the hours lines' bases + the outcome bonus x (replies + meetings + clients). The bonus rate is the one
 * in force on the week's last day (an outcome is counted for the week, not for a day). A figure whose rate is not set
 * stays null and is named in `missing`; nothing is computed from a guess.
 */
export function memberStatement(week: PersonWeek, lines: StatementLine[], history: RateRow[], defaults: Rates, weekStart: string): Statement {
  const atEnd = rateOn(history, defaults, addDays(weekStart, 6));
  const hours = round2(lines.reduce((h, l) => h + l.hours, 0));
  const outcomeCount = week.replies + week.meetings + week.clients;
  const unpriced = lines.some((l) => l.hourly === null && l.hours > 0);
  const base = unpriced ? null : round2(lines.reduce((b, l) => b + (l.base ?? 0), 0));
  const outcomeBonus = typeof atEnd.outcomeBonus === "number" ? atEnd.outcomeBonus : null;
  const bonus = outcomeBonus === null ? null : round2(outcomeCount * outcomeBonus);
  const hourly = typeof atEnd.hourly === "number" ? atEnd.hourly : null;
  const missing = [...(unpriced || (hourly === null && !lines.length) ? ["hourly rate"] : []), ...(outcomeBonus === null ? ["outcome bonus"] : [])];
  return {
    hours,
    hourly,
    base,
    outcomes: outcomeCount,
    outcomeBonus,
    bonus,
    total: base === null || bonus === null ? null : round2(base + bonus),
    currency: atEnd.currency || "USD",
    missing,
    lines,
  };
}

/** Who may set whose rates: the owner anyone's; a manager a member's, never their own, a manager's or the owner's. */
export function canSetRate(actor: { id: string; role: string }, target: { id: string; role: string }): boolean {
  if (actor.role === "owner") return true;
  if (actor.role !== "manager") return false;
  return target.role === "member" && target.id !== actor.id;
}

/** Who may see a person's rates and statement: themselves, the owner, and a manager for a member. */
export function canSeePay(viewer: { id: string; role: string }, target: { id: string; role: string }): boolean {
  return viewer.id === target.id || viewer.role === "owner" || (viewer.role === "manager" && target.role === "member");
}

/** A form's money field: dollars and cents >= 0, or undefined when left empty. */
export function money(v: unknown): number | undefined {
  const t = String(v ?? "").trim();
  const n = Number(t);
  return t && Number.isFinite(n) && n >= 0 ? round2(n) : undefined;
}

export type DayShift = {
  start: string; end: string | null; project: string; minutes: number; notes: { at: string; text: string }[];
  /** Update windows that ended during the shift, and how many had a note (lib/cadence.ts); absent with no cadence. */
  updates?: { expected: number; met: number };
};
export type DayLine = { day: string; minutes: number; shifts: DayShift[] };
type ProjectRow = { id: string; name: string; cadenceHistory?: CadenceEntry[] | null };

/**
 * The week day by day: each shift (by the day it started) with its "Now doing..." notes underneath, oldest first, and
 * "x of y updates" when its project (or the company) has an update cadence. Minutes are rounded per shift to `step` (paid
 * and total figures only; the shift's own times stay raw). Notes are company-visible, so they carry no pay; the statement
 * page that shows them is still behind canSeePay.
 */
export function daysOf(worked: (ShiftLike & { id: string })[], notes: { shiftId: string; at: Date; text: string }[], now: Date,
                       projects: ProjectRow[] = [], settings: TenantSettings = {}, step = 0): DayLine[] {
  const byShift = new Map<string, { at: Date; text: string }[]>();
  for (const n of [...notes].sort((a, b) => a.at.getTime() - b.at.getTime())) byShift.set(n.shiftId, [...(byShift.get(n.shiftId) ?? []), n]);
  const project = new Map(projects.map((p) => [p.id, p]));
  const days = new Map<string, DayLine>();
  for (const s of [...worked].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
    const day = dayOf(s.startedAt);
    const r = roundShift(s.startedAt, s.endedAt ?? now, step);
    const minutes = Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000));
    const own = byShift.get(s.id) ?? [];
    const row = s.projectId === null ? null : project.get(s.projectId) ?? null;
    const u = updateWindows(s, own, cadenceFor(row, settings), now);
    const line = days.get(day) ?? { day, minutes: 0, shifts: [] };
    line.minutes += minutes;
    line.shifts.push({
      start: s.startedAt.toISOString(), end: s.endedAt?.toISOString() ?? null, minutes,
      project: s.projectId === null ? "General" : row?.name ?? "(removed project)",
      notes: own.map((n) => ({ at: n.at.toISOString(), text: n.text })),
      ...(u.expected ? { updates: { expected: u.expected, met: u.met } } : {}),
    });
    days.set(day, line);
  }
  return [...days.values()];
}
