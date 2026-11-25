// Periods beyond this week: one function for every period Peek reports on,
// in the company's time zone (settings.timezone), so two views can never disagree and moving Peek to another machine does not shift a
// day. A period is [from, until): `until` is the next period's start, so an instant belongs to exactly one. Pure.
import { dayIn, validTimeZone } from "./send-goals";

export const PERIOD_KEYS = ["today", "week", "last-week", "month", "last-month", "quarter", "year", "range"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PERIOD_LABEL: Record<PeriodKey, string> = { today: "Today", week: "This week", "last-week": "Last week", month: "This month", "last-month": "Last month", quarter: "This quarter", year: "This year", range: "Date range" };
export const RANGE_MAX_DAYS = 366;

export type Period = { key: PeriodKey; label: string; from: Date; until: Date; fromDay: string; /** The last day inside it. */ toDay: string; /** It has not ended yet. */ current: boolean; /** Exactly one company week. */ weekStart: string | null; problem: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const str = (d: Date) => d.toISOString().slice(0, 10);

/** A calendar day plus n days: no clock involved, so a daylight-saving change cannot move it. */
export const addDay = (day: string, n: number) => {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return str(d);
};
export const isDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(utc(v).getTime()) && str(utc(v)) === v;
export const dayOfWeek = (day: string) => utc(day).getUTCDay();

function offsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** 00:00 of a calendar day in the company's zone; the machine's own midnight when no valid zone is set. */
export function dayStartOf(day: string, tz?: string | null): Date {
  if (!tz || !validTimeZone(tz)) return new Date(`${day}T00:00:00`);
  const guess = utc(day).getTime();
  // twice, so a midnight next to a daylight-saving change lands right
  const at = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(at), tz));
}

/** The first day of the company's week containing `now`. `startDay`: 0 = Sunday ... 6 = Saturday. */
export function weekStartDay(now: Date, startDay = 1, tz?: string | null): string {
  const today = dayIn(now, tz);
  return addDay(today, -((dayOfWeek(today) - startDay + 7) % 7));
}

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const nextMonth = (first: string) => {
  const d = utc(first);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return str(d);
};
const prevMonth = (first: string) => {
  const d = utc(first);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return str(d);
};
const quarterStart = (day: string) => `${day.slice(0, 4)}-${String(Math.floor((+day.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;

function make(key: PeriodKey, fromDay: string, endDay: string, now: Date, tz: string | null | undefined, weekStart: string | null, problem = ""): Period {
  const from = dayStartOf(fromDay, tz);
  const until = dayStartOf(endDay, tz);
  return { key, label: PERIOD_LABEL[key], from, until, fromDay, toDay: addDay(endDay, -1), current: now < until, weekStart, problem };
}

/** The period an address asks for: ?p=<key>, and &from=&to= (both days included) for a range. Anything unusable is this week, with why. */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shiftMonths = (first: string, n: number) => {
  const d = utc(first);
  d.setUTCMonth(d.getUTCMonth() + n);
  return str(d);
};

/** The period an address asks for: ?p=<key>, and &from=&to= (both days included) for a range. An earlier day, week,
 *  month, quarter or year than the current one comes as &at=<a day inside it> (the filter row's arrows); a later one is
 *  the current. Anything unusable is this week, with why. */
export function periodOf(q: { p?: unknown; from?: unknown; to?: unknown; at?: unknown }, now: Date, settings: { timezone?: string | null; updates?: { weekStartDay?: number } } | null | undefined): Period {
  const tz = settings?.timezone;
  const d = settings?.updates?.weekStartDay;
  const startDay = typeof d === "number" && d >= 0 && d <= 6 ? d : 1;
  const today = dayIn(now, tz);
  const at = isDay(q.at) && q.at < today ? q.at : today;
  const weekOf = (day: string) => addDay(day, -((dayOfWeek(day) - startDay + 7) % 7));
  const thisWeek = weekStartDay(now, startDay, tz);
  const week = (problem = "") => make("week", thisWeek, addDay(thisWeek, 7), now, tz, thisWeek, problem);
  const named = (pd: Period, label: string, current: boolean) => (current ? pd : { ...pd, label });
  switch (q.p) {
    case "today":
      return named(make("today", at, addDay(at, 1), now, tz, null), `${DAY_NAMES[dayOfWeek(at)]} ${at}`, at === today);
    case "last-week": {
      const w = addDay(thisWeek, -7);
      return make("last-week", w, thisWeek, now, tz, w);
    }
    case "month": {
      const m = monthStart(at);
      return named(make("month", m, nextMonth(m), now, tz, null), `${MONTH_NAMES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`, m === monthStart(today));
    }
    case "last-month": {
      const m = monthStart(today);
      return make("last-month", prevMonth(m), m, now, tz, null);
    }
    case "quarter": {
      const s = quarterStart(at);
      return named(make("quarter", s, shiftMonths(s, 3), now, tz, null), `Q${Math.floor((+s.slice(5, 7) - 1) / 3) + 1} ${s.slice(0, 4)}`, s === quarterStart(today));
    }
    case "year": {
      const y = at.slice(0, 4);
      return named(make("year", `${y}-01-01`, `${+y + 1}-01-01`, now, tz, null), y, y === today.slice(0, 4));
    }
    case "range": {
      if (!isDay(q.from) || !isDay(q.to)) return week("Give a start and an end date. Showing this week.");
      if (q.from > q.to) return week("The start date is after the end date. Showing this week.");
      const days = Math.round((utc(q.to).getTime() - utc(q.from).getTime()) / 86_400_000) + 1;
      if (days > RANGE_MAX_DAYS) return week(`A range can cover up to ${RANGE_MAX_DAYS} days. Showing this week.`);
      return make("range", q.from, addDay(q.to, 1), now, tz, days === 7 && dayOfWeek(q.from) === startDay ? q.from : null);
    }
    default: {
      const w = weekOf(at);
      return named(make("week", w, addDay(w, 7), now, tz, w), `Week of ${w}`, w === thisWeek);
    }
  }
}

/** The filter row's arrows: the same kind of period one step back, and one step on while that does not start after
 *  today (null then). A day steps a day, a week a week (Last week steps as a week), a month a month, a quarter and a year
 *  likewise, a range by its own length. The current period's address is its plain one. */
export function periodLinks(p: Pick<Period, "key" | "fromDay" | "toDay">, now: Date, tz?: string | null): { prev: string; next: string | null } {
  const today = dayIn(now, tz);
  const ok = (from: string) => from <= today;
  const kind = p.key === "last-week" ? "week" : p.key === "last-month" ? "month" : p.key;
  if (kind === "range") {
    const len = Math.round((utc(p.toDay).getTime() - utc(p.fromDay).getTime()) / 86_400_000) + 1;
    const range = (from: string) => `/week?p=range&from=${from}&to=${addDay(from, len - 1)}`;
    const after = addDay(p.fromDay, len);
    return { prev: range(addDay(p.fromDay, -len)), next: ok(after) ? range(after) : null };
  }
  const step = (n: number) =>
    kind === "today" ? addDay(p.fromDay, n) : kind === "week" ? addDay(p.fromDay, 7 * n) : kind === "month" ? shiftMonths(p.fromDay, n) : kind === "quarter" ? shiftMonths(p.fromDay, 3 * n) : `${+p.fromDay.slice(0, 4) + n}-01-01`;
  const current = (from: string) => (kind === "today" ? from === today : kind === "week" ? addDay(from, 7) > today : kind === "month" ? monthStart(today) === from : kind === "quarter" ? quarterStart(today) === from : from.slice(0, 4) === today.slice(0, 4));
  const link = (from: string) => (current(from) ? (kind === "week" ? "/week" : `/week?p=${kind}`) : kind === "week" ? `/week?at=${from}` : `/week?p=${kind}&at=${from}`);
  const next = step(1);
  return { prev: link(step(-1)), next: ok(next) ? link(next) : null };
}

/** Monday-to-Friday days inside the period that have started by `now`: what a daily goal is multiplied by. */
export function workingDaysIn(p: Pick<Period, "fromDay" | "toDay">, now: Date, tz?: string | null): number {
  const today = dayIn(now, tz);
  const last = p.toDay < today ? p.toDay : today;
  let n = 0;
  for (let day = p.fromDay; day <= last; day = addDay(day, 1)) if (![0, 6].includes(dayOfWeek(day))) n++;
  return n;
}

/** The company weeks that overlap a period, oldest first. */
export function weeksIn(p: Pick<Period, "fromDay" | "toDay">, startDay: number): string[] {
  const out: string[] = [];
  for (let w = addDay(p.fromDay, -((dayOfWeek(p.fromDay) - startDay + 7) % 7)); w <= p.toDay; w = addDay(w, 7)) out.push(w);
  return out;
}

/** A moment as the company reads it. */
export const clockIn = (at: Date | string, tz?: string | null) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(tz && validTimeZone(tz) ? { timeZone: tz } : {}) }).format(new Date(at));
export const stampIn = (at: Date | string, tz?: string | null) => `${dayIn(new Date(at), tz)} ${clockIn(at, tz)}`;
