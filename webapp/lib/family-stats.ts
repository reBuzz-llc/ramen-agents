// The family review's numbers for one bot, from its own files only (read-only): its actions table (explorer.sqlite3,
// read with macOS's sqlite3 in read-only mode, as episodes.ts does), its launchd.err.log and its plan.json. Node
// imports only, so the tests run with Node's own test runner against a fixture database.
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const SQLITE = "/usr/bin/sqlite3";

/** The outputs the review counts when accepted (verdict LIKE 'allowed%'). */
const OUTPUT_TYPES = ["lead", "update_lead", "note", "task", "message", "publish_package", "package", "say", "ask"] as const;
type OutputType = (typeof OUTPUT_TYPES)[number];

export type Window = { actions: number; refused: number; refusedShare: number; accepted: Record<OutputType, number> };
export type BotStats = { w7: Window; w24: Window; lastAction: string | null; crashes: Crashes };

/** A local timestamp in the format the engine writes ("2026-10-28T17:03:28"), for comparing as text. */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function query(db: string, sql: string): Promise<Record<string, string | number | null>[]> {
  const { stdout } = await run(SQLITE, ["-readonly", "-json", "-cmd", ".timeout 3000", `file:${db}?mode=ro`, sql], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

const emptyWindow = (): Window => ({ actions: 0, refused: 0, refusedShare: 0, accepted: Object.fromEntries(OUTPUT_TYPES.map((t) => [t, 0])) as Record<OutputType, number> });

/** Actions, refusals and accepted outputs in the last 7 days and the last 24 hours, in one query, plus the last action. */
export async function actionStats(db: string, now = Date.now()): Promise<{ w7: Window; w24: Window; lastAction: string | null }> {
  const from7 = localIso(now - 7 * 86400e3);
  const from24 = localIso(now - 86400e3);
  const rows = await query(
    db,
    `SELECT action_type AS t, (verdict LIKE 'allowed%') AS ok, COUNT(*) AS n7, SUM(ts >= ${sq(from24)}) AS n24,
            (SELECT MAX(ts) FROM actions) AS last
       FROM actions WHERE ts >= ${sq(from7)} GROUP BY action_type, ok`,
  );
  const w7 = emptyWindow();
  const w24 = emptyWindow();
  let last: string | null = null;
  for (const r of rows) {
    const t = String(r.t);
    const ok = Number(r.ok) === 1;
    for (const [w, n] of [[w7, Number(r.n7 ?? 0)], [w24, Number(r.n24 ?? 0)]] as const) {
      w.actions += n;
      if (!ok) w.refused += n;
      else if ((OUTPUT_TYPES as readonly string[]).includes(t)) w.accepted[t as OutputType] += n;
    }
    last = r.last === null || r.last === undefined ? last : String(r.last);
  }
  if (!rows.length) {
    const [r] = await query(db, "SELECT MAX(ts) AS last FROM actions");
    last = r?.last ? String(r.last) : null;
  }
  for (const w of [w7, w24]) w.refusedShare = w.actions ? w.refused / w.actions : 0;
  return { w7, w24, lastAction: last };
}

/** Crashes in launchd.err.log: Traceback blocks, a chained one ("During handling of the above exception..." / "The above
 *  exception was the direct cause...") counted once with the one before it. The log's lines carry no time and the file
 *  is never cleared, so this is a total since the file was created, not a 24-hour or 7-day figure. */
export function crashCount(logText: string): number {
  const lines = logText.split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("Traceback")) continue;
    const before = lines.slice(Math.max(0, i - 3), i).join("\n");
    if (/During handling of the above exception|The above exception was the direct cause/.test(before)) continue;
    n++;
  }
  return n;
}

type LastCrash = { ts: string; exception: string; message: string };
export type Crashes = { w7: number; w24: number; last: LastCrash | null; total: number; since: string | null };

/** The engine's "run_loop_crashed" lines (engine e831f59 on) in explorer.jsonl text: counts in the last 7 days and 24
 *  hours, and the latest one. A bot writes them only once it runs that engine; before that both counts are 0. */
export function crashEvents(text: string, from7: string, from24: string): { w7: number; w24: number; last: LastCrash | null } {
  let w7 = 0;
  let w24 = 0;
  let last: LastCrash | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"run_loop_crashed"')) continue;
    let e: { ts?: unknown; kind?: unknown; exception?: unknown; message?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = String(e.ts ?? "");
    if (e.kind !== "run_loop_crashed" || ts < from7) continue;
    w7++;
    if (ts >= from24) w24++;
    if (!last || ts > last.ts) last = { ts, exception: String(e.exception ?? ""), message: String(e.message ?? "") };
  }
  return { w7, w24, last };
}

/** Crashes from the bot's logs folder: the timed events from explorer.jsonl and its rotated copies (.1 to .5; a copy
 *  last written before the 7-day window is skipped), and the old untimed Traceback total from launchd.err.log, kept
 *  beside them until every bot runs the engine that writes the events. */
export async function crashesOf(logsDir: string, now = Date.now()): Promise<Crashes> {
  const from7 = localIso(now - 7 * 86400e3);
  const from24 = localIso(now - 86400e3);
  const files = ["explorer.jsonl", ...[1, 2, 3, 4, 5].map((n) => `explorer.jsonl.${n}`)].map((f) => `${logsDir}/${f}`);
  const events = await Promise.all(
    files.map(async (f) => {
      try {
        if ((await stat(f)).mtimeMs < now - 7 * 86400e3) return null;
        return crashEvents(await readFile(f, "utf8"), from7, from24);
      } catch {
        return null;
      }
    }),
  );
  const out: Crashes = { w7: 0, w24: 0, last: null, total: 0, since: null };
  for (const e of events) {
    if (!e) continue;
    out.w7 += e.w7;
    out.w24 += e.w24;
    if (e.last && (!out.last || e.last.ts > out.last.ts)) out.last = e.last;
  }
  try {
    const errLog = `${logsDir}/launchd.err.log`;
    const [text, st] = await Promise.all([readFile(errLog, "utf8"), stat(errLog)]);
    out.total = crashCount(text);
    out.since = localIso(st.birthtimeMs || st.ctimeMs).slice(0, 10);
  } catch {
    // no err log: total stays 0
  }
  return out;
}

export type PlanSummary = { goal: string; done: number; steps: number; activeMin: number | null; status: string } | null;

/** The plan in hand, from plan.json: its goal, steps ticked of all, and the engine's active minutes. */
export function planSummary(raw: unknown): PlanSummary {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { task?: unknown; steps?: unknown; active_min?: unknown; status?: unknown };
  const steps = Array.isArray(p.steps) ? p.steps : [];
  return {
    goal: String(p.task ?? "").slice(0, 240),
    done: steps.filter((s) => (s as { done?: unknown })?.done === true).length,
    steps: steps.length,
    activeMin: typeof p.active_min === "number" ? Math.round(p.active_min) : null,
    status: String(p.status ?? "active"),
  };
}

export type Okr = { objective: string; week: string; krs: { text: string; progress: string }[] };

/** The CEO's okr-week.md (the owner writes it, the Validator adds one "Progress (...)" line under each key result). */
export function parseOkr(md: string): Okr | null {
  const week = /\((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\)/.exec(md);
  const objective = /^Objective:\s*(.*)$/m.exec(md)?.[1].trim() ?? "";
  const krs: { text: string; progress: string }[] = [];
  for (const line of md.split("\n")) {
    const kr = /^\d+\.\s+(.*\S)\s*$/.exec(line);
    if (kr) krs.push({ text: kr[1], progress: "" });
    const p = /^\s+Progress \(([^)]*)\):\s*(.*)$/.exec(line);
    if (p && krs.length) krs[krs.length - 1].progress = p[2].trim();
  }
  if (!objective && !krs.length) return null;
  return { objective, week: week ? `${week[1].slice(5)} to ${week[2].slice(5)}` : "", krs };
}

/** Each bot's own output: the accepted action that is its job, as SQL on the actions table. */
export const OWN_OUTPUT: Record<string, { label: string; where: string }> = {
  "lead-gen": { label: "lead", where: "action_type = 'lead'" },
  "lead-enricher": { label: "lead update", where: "action_type = 'update_lead'" },
  "outreach-writer": {
    label: "draft",
    where: "action_type = 'update_lead' AND (json_extract(payload, '$.draft_email') IS NOT NULL OR json_extract(payload, '$.draft_whatsapp') IS NOT NULL)",
  },
  "package-designer": { label: "package", where: "action_type = 'package'" },
  "research-analyst": { label: "note", where: "action_type = 'note'" },
  "the-ceo": { label: "package or task", where: "action_type IN ('publish_package', 'task')" },
};

/** The time of the bot's last accepted output of its own kind, or null (none yet, or a bot with no own kind). */
export async function lastOwnOutput(db: string, slug: string): Promise<string | null> {
  const own = OWN_OUTPUT[slug];
  if (!own) return null;
  const [r] = await query(db, `SELECT MAX(ts) AS t FROM actions WHERE verdict LIKE 'allowed%' AND ${own.where}`);
  return typeof r?.t === "string" ? r.t : null;
}

/** "3 h ago", "2 d 4 h ago", "12 min ago". */
export function agoWords(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60e3));
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ""} ago`;
}
