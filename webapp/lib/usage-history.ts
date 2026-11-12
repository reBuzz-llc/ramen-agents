// Key providers > Reports (owner, 2026-11-05: "need to see month, past 3 month/quarter or year report"). The engine's
// shared-state/model_calls.json holds today only and starts again each morning, so nothing kept a history: from now on
// the dashboard keeps one. Every 10 minutes (and on each Overview load) it copies today's counters into
// shared-state/usage-history.json, one entry per day: model calls and tokens per provider host, tokens per bot, and the
// day's Tavily, LangSearch and Parallel searches. The counters only grow during a day, so each field keeps its highest
// reading and the last one before midnight is the day's total (at most 10 minutes short). Email checks need no copy:
// email-verify.json dates every address's last check, so they reach back before the history began.
// Read-only towards the bots: this writes only usage-history.json.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const SHARED = path.join(process.env.BOTS_DIR ?? path.join(homedir(), "bots"), "common-data", "shared-state");
export const HISTORY_FILE = "usage-history.json";

export type DayUsage = {
  hosts: Record<string, { calls: number; tokens: number }>;
  bots: Record<string, number>; // tokens
  searches: Record<string, number>; // tavily, langsearch, parallel
  recordedAt: string;
};
export type UsageHistory = { version: 1; since: string; days: Record<string, DayUsage> };

type ModelCalls = { day?: string; counts?: Record<string, number>; usage?: Record<string, Record<string, number[]>>; by_bot?: Record<string, number> };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One day's counters from model_calls.json and the search usage files (each {day: count}), or null when model_calls
 *  has no day. */
export function snapshot(calls: ModelCalls, searches: Record<string, Record<string, number>>, now = new Date()): { day: string; usage: DayUsage } | null {
  const day = calls.day;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const hosts: DayUsage["hosts"] = {};
  const names = new Set([...Object.keys(calls.counts ?? {}), ...Object.keys(calls.usage ?? {})]);
  for (const host of names) {
    const kinds = Object.values(calls.usage?.[host] ?? {});
    const viaKinds = kinds.reduce((a, v) => a + num(v?.[0]), 0);
    const tokens = kinds.reduce((a, v) => a + num(v?.[1]) + num(v?.[2]), 0);
    hosts[host] = { calls: Math.max(num(calls.counts?.[host]), viaKinds), tokens };
  }
  const bots: Record<string, number> = {};
  for (const [b, t] of Object.entries(calls.by_bot ?? {})) bots[b] = num(t);
  const s: Record<string, number> = {};
  for (const [name, byDay] of Object.entries(searches)) s[name] = num(byDay?.[day]);
  return { day, usage: { hosts, bots, searches: s, recordedAt: now.toISOString() } };
}

/** The day's entry with a new reading: each counter keeps its highest value (a counter never goes down within a day). */
export function mergeDay(old: DayUsage | undefined, next: DayUsage): DayUsage {
  if (!old) return next;
  const hosts = { ...old.hosts };
  for (const [h, v] of Object.entries(next.hosts)) {
    const o = hosts[h] ?? { calls: 0, tokens: 0 };
    hosts[h] = { calls: Math.max(o.calls, v.calls), tokens: Math.max(o.tokens, v.tokens) };
  }
  const max = (a: Record<string, number>, b: Record<string, number>) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  return { hosts, bots: max(old.bots, next.bots), searches: max(old.searches, next.searches), recordedAt: next.recordedAt };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function readHistory(dir = SHARED): Promise<UsageHistory> {
  const h = await readJson<Partial<UsageHistory>>(path.join(dir, HISTORY_FILE), {});
  return { version: 1, since: h.since ?? "", days: h.days && typeof h.days === "object" ? h.days : {} };
}

/** Copy today's counters into the history. Answers the day recorded, or null when there was nothing to record. */
export async function recordUsage(dir = SHARED, now = new Date()): Promise<string | null> {
  const [calls, tavily, langsearch, parallel] = await Promise.all([
    readJson<ModelCalls>(path.join(dir, "model_calls.json"), {}),
    readJson<Record<string, number>>(path.join(dir, "tavily-usage.json"), {}),
    readJson<Record<string, number>>(path.join(dir, "langsearch-usage.json"), {}),
    readJson<Record<string, number>>(path.join(dir, "parallel-usage.json"), {}),
  ]);
  const snap = snapshot(calls, { tavily, langsearch, parallel }, now);
  if (!snap) return null;
  const h = await readHistory(dir);
  h.days[snap.day] = mergeDay(h.days[snap.day], snap.usage);
  h.since = Object.keys(h.days).sort()[0] ?? snap.day;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, HISTORY_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(h, null, 1) + "\n");
  await rename(tmp, file); // whole file or nothing, for a reader in the middle of a write
  return snap.day;
}

let recording = false;
export function startUsageRecorder(everyMs = 10 * 60 * 1000): void {
  const g = globalThis as { __usageRecorder?: boolean };
  if (g.__usageRecorder) return;
  g.__usageRecorder = true;
  const tick = async () => {
    if (recording) return;
    recording = true;
    try {
      await recordUsage();
    } catch {
      /* the next tick tries again */
    } finally {
      recording = false;
    }
  };
  void tick();
  setInterval(() => void tick(), everyMs).unref();
}

// ---- the report ---------------------------------------------------------------------------------------------------

export type Period = "month" | "3months" | "quarter" | "year";
export const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "3months", label: "Last 3 months" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
];

export type Bucket = { key: string; label: string; from: string; to: string; calls: number; tokens: number; days: number };
export type UsageReport = {
  period: Period;
  label: string;
  from: string;
  to: string;
  since: string; // the first day the history has ("" when none)
  daysInPeriod: number;
  daysRecorded: number;
  totals: { calls: number; tokens: number; searches: Record<string, number>; emailChecks: number };
  hosts: { host: string; calls: number; tokens: number }[];
  bots: { name: string; tokens: number }[];
  buckets: Bucket[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const short = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** The period's first and last day (today), its title, and its bars: days for a month, weeks (from Monday) for three
 *  months or a quarter, months for a year. */
export function periodRange(period: Period, today: string): { from: string; to: string; label: string; buckets: Omit<Bucket, "calls" | "tokens" | "days">[] } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  let from: string;
  let label: string;
  if (period === "month") {
    from = iso(y, m, 1);
    label = `${MONTHS[m]} ${y}`;
  } else if (period === "3months") {
    from = iso(y, m - 2, 1);
    label = `${MONTHS[(m + 10) % 12]} to ${MONTHS[m]} ${y}`;
  } else if (period === "quarter") {
    const q = Math.floor(m / 3);
    from = iso(y, q * 3, 1);
    label = `Q${q + 1} ${y}`;
  } else {
    from = iso(y, 0, 1);
    label = String(y);
  }
  const to = today;
  const buckets: Omit<Bucket, "calls" | "tokens" | "days">[] = [];
  if (period === "month") {
    for (let d = from; d <= to; d = addDays(d, 1)) buckets.push({ key: d, label: String(Number(d.slice(8))), from: d, to: d });
  } else if (period === "year") {
    for (let i = 0; i <= m; i++) {
      const a = iso(y, i, 1);
      const b = i === m ? to : iso(y, i + 1, 0);
      buckets.push({ key: a.slice(0, 7), label: MONTHS[i], from: a, to: b });
    }
  } else {
    const dow = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
    for (let a = addDays(from, -dow); a <= to; a = addDays(a, 7)) {
      const start = a < from ? from : a;
      const end = addDays(a, 6) > to ? to : addDays(a, 6);
      buckets.push({ key: start, label: short(start), from: start, to: end });
    }
  }
  return { from, to, label, buckets };
}

/** The report for a period, from the history and the email-check cache ({address: {at, by?}}). */
export function usageReport(history: UsageHistory, checks: Record<string, { at?: string; by?: string }>, period: Period, today: string): UsageReport {
  const r = periodRange(period, today);
  const days = Object.entries(history.days).filter(([d]) => d >= r.from && d <= r.to);
  const hosts = new Map<string, { calls: number; tokens: number }>();
  const bots = new Map<string, number>();
  const searches: Record<string, number> = {};
  let calls = 0;
  let tokens = 0;
  const buckets: Bucket[] = r.buckets.map((b) => ({ ...b, calls: 0, tokens: 0, days: 0 }));
  for (const [d, u] of days) {
    let dc = 0;
    let dt = 0;
    for (const [h, v] of Object.entries(u.hosts ?? {})) {
      const o = hosts.get(h) ?? { calls: 0, tokens: 0 };
      hosts.set(h, { calls: o.calls + v.calls, tokens: o.tokens + v.tokens });
      dc += v.calls;
      dt += v.tokens;
    }
    for (const [b, t] of Object.entries(u.bots ?? {})) bots.set(b, (bots.get(b) ?? 0) + t);
    for (const [s, n] of Object.entries(u.searches ?? {})) searches[s] = (searches[s] ?? 0) + n;
    calls += dc;
    tokens += dt;
    const bucket = buckets.find((b) => d >= b.from && d <= b.to);
    if (bucket) {
      bucket.calls += dc;
      bucket.tokens += dt;
      bucket.days += 1;
    }
  }
  const emailChecks = Object.values(checks).filter((c) => {
    const d = (c?.at ?? "").slice(0, 10);
    return d >= r.from && d <= r.to && (!c.by || c.by === "quickemailverification");
  }).length;
  return {
    period,
    label: r.label,
    from: r.from,
    to: r.to,
    since: history.since || (Object.keys(history.days).sort()[0] ?? ""),
    daysInPeriod: daysBetween(r.from, r.to),
    daysRecorded: days.length,
    totals: { calls, tokens, searches, emailChecks },
    hosts: [...hosts].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.tokens - a.tokens || b.calls - a.calls),
    bots: [...bots].map(([name, t]) => ({ name, tokens: t })).sort((a, b) => b.tokens - a.tokens),
    buckets,
  };
}

/** Today in the Mac's own time zone, as model_calls.json dates its day. */
export const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export async function reportFor(period: Period, dir = SHARED, today = localDay()): Promise<UsageReport> {
  const [history, checks] = await Promise.all([
    readHistory(dir),
    readJson<Record<string, { at?: string; by?: string }>>(path.join(dir, "email-verify.json"), {}),
  ]);
  return usageReport(history, checks, period, today);
}
