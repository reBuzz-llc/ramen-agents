// The family review's downtime line (creatorCC queue 4, 2026-10-29): when the Mac was off and when every bot sat quiet,
// so a low day is not read as bad bots. Mac-off spans come from `last reboot shutdown`; a reboot with no shutdown just
// before it was unplanned, and its gap starts at the latest action any bot logged before that boot. Quiet spans come
// from one running bot's explorer.jsonl ("quiet" reason=..., then "quiet_over" minutes=...): all bots pause together.
// Node imports only, so the tests run with Node's own test runner.
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** As family-stats' localIso (copied: Node's test runner needs ".ts" on a relative import, the app's type check forbids it). */
function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type Span = { from: string; to: string; minutes: number; note: string };
export type Downtime = { off: Span[]; quiet: Span[]; offMin: number; quietMin: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `last reboot shutdown` lines ("reboot time   Thu Oct 29 19:05"), oldest first. The output has no year: a date that
 *  would fall after now is last year's. */
export function parseLast(text: string, now: number): { kind: "reboot" | "shutdown"; at: number }[] {
  const out: { kind: "reboot" | "shutdown"; at: number }[] = [];
  const year = new Date(now).getFullYear();
  for (const line of text.split("\n")) {
    const m = /^(reboot|shutdown) time\s+\w{3} (\w{3})\s+(\d{1,2}) (\d{2}):(\d{2})/.exec(line);
    if (!m) continue;
    const mon = MONTHS.indexOf(m[2]);
    if (mon < 0) continue;
    let at = new Date(year, mon, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
    if (at > now + 60e3) at = new Date(year - 1, mon, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
    out.push({ kind: m[1] as "reboot" | "shutdown", at });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Clip [a, b] (ms) to the window and make a span; null when nothing of it is inside. */
function span(a: number, b: number, from: number, now: number, note: string): Span | null {
  const s = Math.max(a, from);
  const e = Math.min(b, now);
  if (e <= s) return null;
  return { from: localIso(s), to: localIso(e), minutes: Math.round((e - s) / 60e3), note };
}

/** Mac-off spans in the window. `lastActionBefore` gives the latest bot action (ms) before a time, for unplanned boots. */
export async function offSpans(events: { kind: "reboot" | "shutdown"; at: number }[], from: number, now: number, lastActionBefore: (ms: number) => Promise<number | null>): Promise<Span[]> {
  const out: Span[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== "reboot" || e.at <= from) continue;
    const prev = events[i - 1];
    const clean = prev?.kind === "shutdown";
    const start = clean ? prev.at : ((await lastActionBefore(e.at)) ?? prev?.at ?? null);
    if (start === null) continue;
    const s = span(start, e.at, from, now, clean ? "shut down" : "no clean shutdown logged");
    if (s) out.push(s);
  }
  return out;
}

/** Quiet spans in the window from explorer.jsonl text: each "quiet_over" closes the "quiet" before it (its reason); a
 *  quiet still open at the end runs to now. */
export function quietSpans(text: string, from: number, now: number): Span[] {
  const out: Span[] = [];
  let open: { at: number; reason: string } | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"quiet')) continue;
    let e: { ts?: unknown; kind?: unknown; reason?: unknown; minutes?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = new Date(String(e.ts ?? "")).getTime();
    if (Number.isNaN(at)) continue;
    if (e.kind === "quiet") open ??= { at, reason: String(e.reason ?? "") };
    else if (e.kind === "quiet_over") {
      const minutes = Number(e.minutes);
      const start = Number.isFinite(minutes) ? at - minutes * 60e3 : (open?.at ?? at);
      const s = span(start, at, from, now, open?.reason ?? "");
      if (s) out.push(s);
      open = null;
    }
  }
  if (open) {
    const s = span(open.at, now, from, now, `${open.reason} (still quiet)`);
    if (s) out.push(s);
  }
  return out;
}

const total = (spans: Span[]) => spans.reduce((n, s) => n + s.minutes, 0);

/** The downtime in [from, now]: `jsonl` are one bot's explorer.jsonl and its rotated copies, oldest first. */
export async function downtime(lastText: string, jsonl: string[], from: number, now: number, lastActionBefore: (ms: number) => Promise<number | null>): Promise<Downtime> {
  const off = await offSpans(parseLast(lastText, now), from, now, lastActionBefore);
  const quiet = quietSpans(jsonl.join("\n"), from, now);
  return { off, quiet, offMin: total(off), quietMin: total(quiet) };
}

/** `last reboot shutdown`, or "" when it cannot run. */
export async function lastOutput(): Promise<string> {
  return run("/usr/bin/last", ["reboot", "shutdown"], { timeout: 5000 }).then(
    (r) => r.stdout,
    () => "",
  );
}

/** One bot's explorer.jsonl with its rotated copies, oldest first; copies last written before `from` are skipped. */
export async function jsonlTexts(logsDir: string, from: number): Promise<string[]> {
  const files = [5, 4, 3, 2, 1].map((n) => `${logsDir}/explorer.jsonl.${n}`).concat(`${logsDir}/explorer.jsonl`);
  const texts = await Promise.all(
    files.map(async (f) => {
      try {
        if ((await stat(f)).mtimeMs < from) return "";
        return await readFile(f, "utf8");
      } catch {
        return "";
      }
    }),
  );
  return texts.filter(Boolean);
}

/** "9 h 1 min", "40 min". */
export function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}
