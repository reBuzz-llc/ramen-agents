// The health banner (2026-10-29): one red line at the top of the dashboard when something needs a
// human, nothing when all is well. Each condition is one short sentence with the time it started:
//   (a) the Validator's last_run older than 8 h, or its last_full_sweep older than 30 h;
//   (b) an unplanned reboot (no shutdown logged) in the last 24 h;
//   (c) a running bot with no accepted action for 2 h of time it was awake: not quiet, not resting, Mac not off.
//   (d) the main model provider (most calls today) failing for over an hour, from model_calls.json "health".
// The checks are pure functions over the files' text, so the tests run them on fixtures; health() reads the files.
// Node imports only.

export type Issue = { key: string; since: string; text: string };

const VALIDATOR_RUN_H = 8;
const VALIDATOR_SWEEP_H = 30;
const IDLE_MIN = 120;

const hhmm = (iso: string) => iso.replace("T", " ").slice(5, 16);
const ageH = (iso: string, now: number) => (now - new Date(iso).getTime()) / 3600e3;

/** (a) The Validator stopped: from its state.json. */
export function validatorIssue(stateText: string, now: number): Issue | null {
  let s: { last_run?: unknown; last_full_sweep?: unknown };
  try {
    s = JSON.parse(stateText);
  } catch {
    return { key: "validator", since: "", text: "The Validator's state.json could not be read." };
  }
  const run = typeof s.last_run === "string" ? s.last_run : "";
  const sweep = typeof s.last_full_sweep === "string" ? s.last_full_sweep : "";
  if (run && ageH(run, now) > VALIDATOR_RUN_H)
    return { key: "validator", since: run, text: `The Validator has not run since ${hhmm(run)}${sweep ? ` (last full sweep ${hhmm(sweep)})` : ""}.` };
  if (sweep && ageH(sweep, now) > VALIDATOR_SWEEP_H) return { key: "validator", since: sweep, text: `The Validator's last full sweep was ${hhmm(sweep)}, over ${VALIDATOR_SWEEP_H} h ago.` };
  return null;
}

/** (a) from the Validator's own shared-state/validator-health.json (written after every run): the same
 *  last_run / last_full_sweep conditions read from it, plus one line per board job whose last result failed, "The
 *  Validator's <job> failed at HH:MM: <error>", which clears when the job next succeeds. Without the file (or when it
 *  cannot be read) the conditions come from its state.json as before. */
export function validatorHealthIssues(healthText: string | null, stateText: string, now: number): Issue[] {
  let h: { last_run?: unknown; last_full_sweep?: unknown; jobs?: Record<string, { ok?: unknown; error?: unknown; at?: unknown }> } | null = null;
  if (healthText) {
    try {
      h = JSON.parse(healthText);
    } catch {
      h = null;
    }
  }
  if (!h || typeof h !== "object") {
    const v = validatorIssue(stateText, now);
    return v ? [v] : [];
  }
  const out: Issue[] = [];
  const v = validatorIssue(JSON.stringify({ last_run: h.last_run ?? "", last_full_sweep: h.last_full_sweep ?? "" }), now);
  if (v) out.push(v);
  for (const [name, j] of Object.entries(h.jobs ?? {})) {
    if (!j || j.ok !== false) continue;
    const at = typeof j.at === "string" ? j.at : "";
    const error = String(j.error ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    out.push({ key: `validator-job:${name}`, since: at, text: `The Validator's ${name} failed${at ? ` at ${at.slice(11, 16)}` : ""}${error ? `: ${error}` : ""}.` });
  }
  return out;
}

/** (b) Unplanned reboots in the last 24 h, from the downtime spans ("no clean shutdown logged"). */
export function rebootIssue(off: { from: string; to: string; note: string }[]): Issue | null {
  const bad = off.filter((s) => s.note === "no clean shutdown logged");
  if (!bad.length) return null;
  const s = bad[bad.length - 1];
  return { key: "reboot", since: s.from, text: `The Mac went off without a clean shutdown at ${hhmm(s.from)} and came back at ${hhmm(s.to)}.` };
}

type Interval = [number, number];

/** When a bot was not expected to act, from its explorer.jsonl text: quiet to quiet_over, and resting / day_block_rest
 *  for their minutes from their time. A quiet still open runs to now. */
export function restIntervals(text: string, now: number): Interval[] {
  const out: Interval[] = [];
  let quietAt: number | null = null;
  for (const line of text.split("\n")) {
    if (!/"kind": "(quiet|quiet_over|resting|day_block_rest)"/.test(line)) continue;
    let e: { ts?: unknown; kind?: unknown; minutes?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = new Date(String(e.ts ?? "")).getTime();
    if (Number.isNaN(at)) continue;
    const min = Number(e.minutes);
    if (e.kind === "quiet") quietAt ??= at;
    else if (e.kind === "quiet_over") {
      out.push([Number.isFinite(min) ? at - min * 60e3 : (quietAt ?? at), at]);
      quietAt = null;
    } else if (Number.isFinite(min)) out.push([at, at + min * 60e3]);
  }
  if (quietAt !== null) out.push([quietAt, now]);
  return out;
}

/** Minutes of [from, now] not covered by any interval. */
export function awakeMinutes(from: number, now: number, covered: Interval[]): number {
  const parts = covered
    .map(([a, b]): Interval => [Math.max(a, from), Math.min(b, now)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let free = 0;
  let at = from;
  for (const [a, b] of parts) {
    if (a > at) free += a - at;
    at = Math.max(at, b);
  }
  if (now > at) free += now - at;
  return free / 60e3;
}

/** (c) A running bot idle while awake: no accepted action since `lastAccepted` for 2 h of awake time. */
export function idleIssue(name: string, lastAccepted: string | null, rests: Interval[], off: Interval[], now: number): Issue | null {
  if (!lastAccepted) return null;
  const awake = awakeMinutes(new Date(lastAccepted).getTime(), now, [...rests, ...off]);
  if (awake < IDLE_MIN) return null;
  const h = Math.floor(awake / 60);
  return { key: `idle:${name}`, since: lastAccepted, text: `${name} has had no accepted action since ${hhmm(lastAccepted)} (${h} h ${Math.round(awake % 60)} min awake, not resting).` };
}

type ProviderHealth = { last_ok?: string; last_fail?: string; last_reason?: string; first_fail?: string };
export type Provider = { host: string; label: string; calls: number; ok: boolean | null; dot: boolean };

// Ledger keys that are not chain providers, with their label: the Validator's judge calls Gemini directly and keeps its
// own key, with no health record (2026-10-29); the chain's Gemini calls count under "gemini".
const SIDE_KEYS: Record<string, string> = { "generativelanguage.googleapis.com": "Gemini (Validator judge)" };
const LABELS: Record<string, string> = { gemini: "Gemini" };
type ModelCalls = { counts?: Record<string, number>; health?: Record<string, ProviderHealth> };

function modelCalls(text: string): ModelCalls {
  try {
    return JSON.parse(text) as ModelCalls;
  } catch {
    return {};
  }
}

/** Failing: its last failure is newer than its last answer (or it never answered). null: no health line for it yet. */
const failing = (h: ProviderHealth | undefined): boolean | null => (h?.last_fail ? !h.last_ok || h.last_fail > h.last_ok : h?.last_ok ? false : null);

/** Today's providers, most calls first, with a health dot (null while the engine has written no health for it). */
export function providerStrip(text: string): Provider[] {
  const m = modelCalls(text);
  return Object.entries(m.counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([host, calls]) => {
      const side = host in SIDE_KEYS;
      const f = side ? null : failing(m.health?.[host]);
      return { host, label: SIDE_KEYS[host] ?? LABELS[host] ?? host, calls, ok: f === null ? null : !f, dot: !side };
    });
}

/** (d) The main provider (the most calls today among the chain's) has been failing for over an hour: from first_fail (engine d465e06: set
 *  on the first failure after a success, cleared by the next), so a Mac-off gap is no outage; a record from before
 *  that engine falls back to its last answer (or, if it never answered, its last failure). Missing health = no condition. */
export function providerIssue(text: string, now: number): Issue | null {
  const m = modelCalls(text);
  const main = providerStrip(text).find((p) => p.dot)?.host;
  const h = main ? m.health?.[main] : undefined;
  if (!main || !h || !failing(h)) return null;
  const since = h.first_fail ?? h.last_ok ?? h.last_fail ?? "";
  if (!since || ageH(since, now) <= 1) return null;
  const reason = (h.last_reason ?? "").trim();
  return { key: "provider", since, text: `The main model provider ${main} has not answered since ${hhmm(since)}${reason ? ` (${reason})` : ""}.` };
}
