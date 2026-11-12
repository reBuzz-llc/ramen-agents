// The Validator's tick report (common-data/shared-state/tick-report.json, written every few minutes) as a heartbeat for
// the provider pages (creatorCC queue 315: on 11-06 it stopped for an hour and nobody saw). Its "at" is local time
// without a zone, as the Validator writes it. Pure (no imports), so client components and Node's test runner can load it;
// lib/tick-read.ts reads the file.
/** Older than this, the line turns red. */
export const TICK_STALE_MIN = 30;

export type Tick = { at: string | null; minutes: number | null; stale: boolean; paused?: string };

/** During a planned pause (lib/trial.ts) an old tick is expected: not stale, and the line says why. */
export const pausedTick = (t: Tick, line: string | null | undefined): Tick => (line ? { ...t, stale: false, paused: line } : t);

/** How old the last tick is. No report, or one without a readable time, counts as stale. */
export function tickOf(at: unknown, now: number): Tick {
  const s = typeof at === "string" ? at.trim() : "";
  const ms = s ? new Date(s).getTime() : NaN; // a zone-less ISO string is read as local time
  if (!Number.isFinite(ms)) return { at: null, minutes: null, stale: true };
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  return { at: s, minutes, stale: minutes > TICK_STALE_MIN };
}

/** The line the pages show: "Last tick 15:49 (3 min ago)", or why it is red. */
export function tickLine(t: Tick): string {
  if (t.paused) return `${t.paused}.`;
  if (!t.at || t.minutes === null) return "No tick report from the Validator: these numbers may be old. Check the Validator (launchd com.rebuzz.validator).";
  const ago = t.minutes < 1 ? "just now" : t.minutes < 120 ? `${t.minutes} min ago` : `${Math.round(t.minutes / 60)} h ago`;
  const when = t.at.slice(11, 16);
  return t.stale
    ? `Last tick ${when} (${ago}): the Validator has not reported for over ${TICK_STALE_MIN} minutes, so these numbers may be old. Check the Validator (launchd com.rebuzz.validator).`
    : `Last tick ${when} (${ago})`;
}
