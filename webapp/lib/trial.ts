// A planned pause of the whole family (creatorCC queue 371, 2026-11-09: tonight's judge trial): valiCC pauses the bots
// with STOP lines "valiCC: judge trial, back by 03:15" and the Validator with validator/workspace/PAUSE, and writes
// common-data/shared-state/validator-paused.json {from, to, reason}. While that file exists, or any bot's STOP starts
// with "valiCC: judge trial", the world and the list view show one calm line, and the red "stale tick", "Validator has
// not run" and "no accepted action" lines stay quiet: the pause is on purpose. Pure (no imports), for the tests.
export const TRIAL_PREFIX = "valiCC: judge trial";
/** After the trial's end ("to", or "back by") plus this, the pause no longer explains anything (creatorCC queue 372): the
 *  calm line goes and the red lines come back, even if the file or a STOP was left behind by a crashed trial. */
export const TRIAL_GRACE_MIN = 30;
/** A pause with no end time at all counts for this long after it was written. */
export const TRIAL_MAX_H = 6;

export type Trial = { from: string | null; to: string | null; reason: string; line: string };

/** "2026-11-10T01:56:00" or "01:56" as "01:56"; anything else as given, or null. */
function hhmm(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const m = /(?:T|\s|^)(\d{1,2}:\d{2})/.exec(s);
  return m ? m[1].padStart(5, "0") : s;
}

/** The end as a time: a full date-time as given; a bare "03:15" as the first 03:15 at or after the pause was written
 *  (else the 03:15 nearest to now). */
function endAt(v: string | null, since: number | null, now: number): number | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const ref = new Date(since ?? now);
  let t = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), Number(m[1]), Number(m[2])).getTime();
  if (since !== null) {
    if (t < since) t += 86_400_000;
  } else if (t - now > 12 * 3600e3) t -= 86_400_000;
  else if (now - t > 12 * 3600e3) t += 86_400_000;
  return t;
}

export type TrialOpts = { now?: number; pausedAt?: number | null; stopAt?: (number | null)[] };

/** The trial from the Validator's pause file (its parsed JSON, or null when there is none) and the bots' STOP texts;
 *  null when there is none, or when it ended more than TRIAL_GRACE_MIN minutes ago. `pausedAt` and `stopAt` are when the
 *  file and each STOP were written (to place a bare "03:15"). */
export function trialOf(paused: unknown, stops: string[], opts: TrialOpts = {}): Trial | null {
  const now = opts.now ?? Date.now();
  const p = paused && typeof paused === "object" && !Array.isArray(paused) ? (paused as Record<string, unknown>) : null;
  const at = stops.map((s) => s.trim()).findIndex((s) => s.toLowerCase().startsWith(TRIAL_PREFIX.toLowerCase()));
  const stop = at >= 0 ? stops[at].trim() : undefined;
  if (!p && !stop) return null;
  const from = hhmm(p?.from);
  const back = stop ? /back by\s+(\d{1,2}:\d{2})/i.exec(stop)?.[1] ?? null : null;
  const to = hhmm(p?.to) ?? (back ? back.padStart(5, "0") : null);
  // over: the end plus the grace has passed (a full "to" from the file, else its or the STOP's bare time)
  const since = (p ? opts.pausedAt : null) ?? (at >= 0 ? opts.stopAt?.[at] ?? null : null) ?? null;
  const rawTo = typeof p?.to === "string" && p.to.trim() ? p.to.trim() : back;
  const end = endAt(rawTo && /^\d{4}-/.test(rawTo) ? rawTo : to, since, now);
  if (end !== null ? now > end + TRIAL_GRACE_MIN * 60_000 : since !== null && now > since + TRIAL_MAX_H * 3600e3) return null;
  const reason = (typeof p?.reason === "string" && p.reason.trim()) || "Judge trial";
  const when = from && to ? ` ${from}-${to}` : to ? ` until ${to}` : "";
  const what = /judge trial/i.test(reason) || stop ? "Judge trial" : reason;
  return { from, to, reason, line: `${what} running${when}: the family and the Validator are paused on purpose` };
}

/** The health banner's issues with the ones the pause explains taken out: the Validator not running, bots idle. */
export function quietDuringTrial<T extends { key: string }>(issues: T[], trial: Trial | null): T[] {
  if (!trial) return issues;
  return issues.filter((i) => i.key !== "validator" && !i.key.startsWith("idle:"));
}
