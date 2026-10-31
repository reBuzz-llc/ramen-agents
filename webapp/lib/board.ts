// The home page's live family board (2026-10-30, owner: "first change the home page to a live board
// where I can see all family working on what"). Read-only, per running bot:
//   - its state word, from the newest heartbeat row (explorer.sqlite3), the tail of logs/explorer.jsonl (resting,
//     day_block_rest, quiet, quiet_over, action), day-blocks.json, the owner's PAUSE file and The CEO's HOLD;
//   - what it is on now (plan.json's task and step, else the episode's question, else its last thought);
//   - its last accepted action in words, today's own output, refused share and actions per hour;
//   - its last accepted outputs of its own kind, for the family feed.
// The pure parts are exported for the tests; boardBot() does the reading. Node imports only (the test runner needs
// ".ts" on a relative import, the app's type check forbids it), so the sqlite read is repeated here.
import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Tone = "good" | "muted" | "warn" | "bad";
export type State = { word: string; tone: Tone; why: string };
export type Hb = {
  ts: string;
  status: string;
  last_progress_at: string | null;
  model_failures: number;
  current_question: string | null;
  next_planned: string | null;
  current_url?: string | null;
  stall_minutes?: number | null; // the engine's own stall threshold for this bot (cb57a61); older databases lack it
};
type Ev = { ts: string; at: number; kind: string; reason: string; minutes: number | null };
type Hold = { mode: string; until: number; why: string } | null;

const NO_HEARTBEAT_MIN = 10;
const STALL_MIN = 15; // the stall threshold when the heartbeat row carries none (an engine before cb57a61)
const KINDS = new Set(["resting", "day_block_rest", "quiet", "quiet_over", "action", "episode", "stop", "resume"]);

export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const hhmm = (ms: number) => localIso(ms).slice(11, 16);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const one = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The events the state needs from explorer.jsonl text, oldest first; other lines and torn lines are skipped. */
export function parseEvents(text: string): Ev[] {
  const out: Ev[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"kind"')) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = String(e.kind ?? "");
    if (!KINDS.has(kind)) continue;
    const ts = String(e.ts ?? "");
    const at = new Date(ts).getTime();
    if (Number.isNaN(at)) continue;
    const m = Number(e.minutes);
    out.push({ ts, at, kind, reason: one(e.reason), minutes: Number.isFinite(m) ? m : null });
  }
  return out;
}

/** "the work list is empty, today's tasks (1) and messages (20) are done" -> "work list empty". */
function restWhy(reason: string): string {
  if (/work list is empty/i.test(reason)) return "work list empty";
  return clip(reason, 80);
}

const minWords = (min: number) => (min < 90 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h`);

/** The bot's state word. Order matters: the owner's pause and The CEO's hold first, then a rest or quiet that is still
 *  on (the engine ticks the heartbeat only when a rest starts), then a missing heartbeat, then the heartbeat's own say. */
export function stateOf(i: { hb: Hb | null; events: Ev[]; now: number; dayBlocks: number; paused: boolean; pauseUntil?: string; hold: Hold; restarting?: boolean }): State {
  const { hb, events, now } = i;
  // restart-bot.sh keeps workspace/RESTARTING for its run (its own STOP is in place meanwhile): not the owner's stop
  if (i.restarting) return { word: "restarting", tone: "muted", why: "back in a minute" };
  if (i.paused) {
    // A timed pause (the owner's, from the world) holds its end time as the file's text; past it the engine works again
    // though the file stays, so then it is not paused at all. Any other text, or none, is the plain flag.
    const end = i.pauseUntil ? new Date(i.pauseUntil).getTime() : NaN;
    if (Number.isNaN(end)) return { word: "paused", tone: "muted", why: "your PAUSE file" };
    if (end > now) return { word: "paused", tone: "muted", why: `until ${hhmm(end)}` };
  }
  if (i.hold && i.hold.mode === "pause" && i.hold.until * 1000 > now)
    return { word: "blocked on The CEO's hold", tone: "warn", why: `until ${hhmm(i.hold.until * 1000)}${i.hold.why ? `: ${clip(i.hold.why, 80)}` : ""}` };
  const lastOf = (...kinds: string[]) => [...events].reverse().find((e) => kinds.includes(e.kind));
  const rest = lastOf("resting", "day_block_rest");
  const after = (e: Ev) => events.some((x) => x.at > e.at && (x.kind === "action" || x.kind === "episode" || x.kind === "resume"));
  if (rest && !after(rest)) {
    const end = rest.at + (rest.minutes ?? 30) * 60e3;
    if (end > now) {
      const why = rest.kind === "day_block_rest" ? `${i.dayBlocks || 3} things blocked today` : restWhy(rest.reason);
      return { word: `resting until ${hhmm(end)}`, tone: "muted", why };
    }
  }
  const quiet = lastOf("quiet", "quiet_over");
  if (quiet?.kind === "quiet" && !after(quiet)) return { word: "quiet", tone: "muted", why: quiet.reason };
  const signs = [hb ? new Date(hb.ts).getTime() : NaN, events.length ? events[events.length - 1].at : NaN].filter(Number.isFinite);
  if (!signs.length) return { word: "no heartbeat", tone: "bad", why: "none written yet" };
  const silent = (now - Math.max(...signs)) / 60e3;
  if (silent > NO_HEARTBEAT_MIN) return { word: `no heartbeat ${minWords(silent)}`, tone: "bad", why: `last sign ${hhmm(Math.max(...signs))}` };
  if (hb?.status === "quiet") return { word: "quiet", tone: "muted", why: one(hb.next_planned) };
  if (hb?.status === "paused") return { word: "paused", tone: "muted", why: "" };
  if (hb?.status === "model_failure")
    return { word: "blocked on the model provider", tone: "warn", why: `${hb.model_failures} failed call${hb.model_failures === 1 ? "" : "s"} in a row` };
  if (hb?.status.startsWith("idle")) return { word: "waiting for a task", tone: "muted", why: "in chat" };
  // A rest or quiet spell is not a stall: count from when the bot went back to work (its first episode, action or
  // resume after the last one), since the heartbeat keeps the progress time from before the rest until its next tick
  // (queue 30: The CEO read "stalled, 18 min" from 09:44:27, its episode after a 09:29 day_block_rest, to 09:44:42).
  const pause = lastOf("resting", "day_block_rest", "quiet");
  const back = pause ? events.find((x) => x.at > pause.at && (x.kind === "action" || x.kind === "episode" || x.kind === "resume")) : undefined;
  const hbProgress = hb?.last_progress_at ? new Date(hb.last_progress_at).getTime() : NaN;
  const progress = back && !(hbProgress > back.at) ? back.at : hbProgress;
  const stallMin = hb?.stall_minutes ?? STALL_MIN; // the bot's own pace: 30 for Scout, 15 for the 20 s bots
  if (Number.isFinite(progress) && (now - progress) / 60e3 >= stallMin)
    return { word: "stalled", tone: "bad", why: `no progress for ${minWords((now - progress) / 60e3)}` };
  return { word: "working", tone: "good", why: "" };
}

/** What the bot is on: its active plan's task and current step, else the episode's question, else its last thought. */
export function nowOn(plan: unknown, question: string | null, thought: string | null): string {
  const p = plan && typeof plan === "object" ? (plan as Record<string, unknown>) : null;
  if (p && (p.status ?? "active") === "active" && one(p.task)) {
    const steps = Array.isArray(p.steps) ? p.steps.map((s) => (s ?? {}) as Record<string, unknown>).filter((s) => one(s.text)) : [];
    const k = steps.findIndex((s) => s.done !== true);
    const step = k >= 0 ? ` · step ${k + 1} of ${steps.length}: ${clip(one(steps[k].text), 120)}` : "";
    return `${clip(one(p.task), 160)}${step}`;
  }
  return clip(one(question) || one(thought), 200);
}

/** Which of the three nowOn() used. */
function onKindOf(plan: unknown, question: string | null, thought: string | null): BotCard["onKind"] {
  const p = plan && typeof plan === "object" ? (plan as Record<string, unknown>) : null;
  if (p && (p.status ?? "active") === "active" && one(p.task)) return "plan";
  if (one(question)) return "question";
  return one(thought) ? "thought" : "";
}

const host = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, "");
  } catch {
    return one(u);
  }
};
const q = (v: unknown, n = 60) => `'${clip(one(v), n)}'`;

/** An action in words: "opened salon.example", "listed lead 'Lina'". */
export function actionWords(type: string, payloadJson: string | null): string {
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(payloadJson ?? "{}") ?? {};
  } catch {
    /* words from the type alone */
  }
  switch (type) {
    case "open":
      return `opened ${host(p.url)}`;
    case "search":
      return `searched ${q(p.query)}`;
    case "lead":
      return `listed lead ${q(p.name)}`;
    case "update_lead":
      return p.draft_email || p.draft_whatsapp ? `drafted ${p.draft_email ? "an email" : "a WhatsApp message"} for ${q(p.name)}` : `updated lead ${q(p.name)}`;
    case "note":
      return `wrote note ${q(p.title)}`;
    case "package":
      return `designed package ${q(p.name)}`;
    case "publish_package":
      return `published package ${q(p.name)}`;
    case "task":
      return `set task ${q(p.title)}`;
    case "update_task":
      return `updated task ${q(p.title)}`;
    case "message":
      return `messaged ${one(p.to) || "the family"}`;
    case "say":
      return `answered ${one(p.to) || "in chat"}`;
    case "ask":
      return `asked ${q(p.question)}`;
    case "follow":
      return "followed a link";
    case "read":
      return "read the page";
    case "back":
      return "went back a page";
    case "plan":
      return "updated its plan";
    case "summarize":
      return "summed up the episode";
    case "revise_goal":
      return "revised its own goal";
    case "rest":
      return "rested";
    default:
      return type.replace(/_/g, " ");
  }
}

/** "40 s ago", "3 min ago", "2 h ago". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** What the bot's monitor shows for its last accepted action: a web page (domain and title), a search box (the query),
 *  or a document (the lead, note, package or task title). */
export type Screen = { kind: "web" | "search" | "doc" | "other"; domain: string; title: string };
export type Last = { ts: string; words: string; ago: string; screen: Screen } | null;

const DOC_TYPES = new Set(["lead", "update_lead", "note", "package", "publish_package", "task", "update_task", "message", "say"]);

/** The monitor's content from an action: its type, payload and result ("opened https://x.com: 'Title' (...)"), and the
 *  page the heartbeat says is open (a read carries no URL of its own). */
/** Page titles arrive HTML-escaped, sometimes several times over ("&amp;amp;amp;"): undo it until nothing changes. */
function unescape(s: string): string {
  let prev = "";
  let out = s;
  for (let i = 0; i < 4 && out !== prev; i++) {
    prev = out;
    out = out
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  return out;
}

export function screenOf(type: string, payloadJson: string | null, result: string | null, currentUrl: string | null): Screen {
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(payloadJson ?? "{}") ?? {};
  } catch {
    /* type alone */
  }
  const res = one(result);
  if (type === "search") return { kind: "search", domain: "", title: one(p.query) };
  if (type === "open" || type === "follow" || type === "read" || type === "back") {
    const m = /(?:opened|to) (https?:\/\/\S+?):? '([^']*)'?/.exec(res);
    const url = m?.[1] ?? (typeof p.url === "string" ? p.url : "") ?? "";
    const page = url || (currentUrl && /^https?:/.test(currentUrl) ? currentUrl : "");
    return { kind: "web", domain: page ? host(page) : "", title: unescape(m?.[2] ?? "") };
  }
  if (DOC_TYPES.has(type)) return { kind: "doc", domain: "", title: unescape(one(p.name) || one(p.title) || one(p.to)) || type.replace(/_/g, " ") };
  return { kind: "other", domain: "", title: type.replace(/_/g, " ") };
}
export type FeedItem = { slug: string; name: string; ts: string; words: string };
export type BotCard = {
  slug: string;
  name: string;
  handle: string;
  state: State;
  on: string;
  onKind: "plan" | "question" | "thought" | ""; // where `on` came from
  last: Last;
  output: { label: string; today: number } | null;
  refusedShare: number | null; // today; null with no actions today
  actionsToday: number;
  hours: number[]; // actions per hour today, 0..23
  questions: string[]; // its open questions, most pursued first (up to 3)
  interests: string[]; // its strongest interests (up to 3)
  model: { label: string; ts: string } | null; // the provider/model its last call used, from the log (never the configured fallback)
  feed: FeedItem[];
};

/** The provider and model the bot's last call used: the newest "using <label>" line (the engine logs one on each switch),
 *  or the provider= of a repaired or model_failure event, whichever is newer. */
function lastModel(text: string): { label: string; ts: string } | null {
  let out: { label: string; ts: string } | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"using ') && !line.includes('"provider"')) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = String(e.ts ?? "");
    const msg = String(e.msg ?? "");
    const label = msg.startsWith("using ") ? msg.slice(6).trim() : e.kind === "repaired" || e.kind === "model_failure" ? one(e.provider) : "";
    if (label && ts && (!out || ts >= out.ts)) out = { label, ts };
  }
  return out;
}

/** Today's per-hour rows -> 24 counts, the total, refused and own-output sums. */
export function hourly(rows: { h: string | number; n: number; r: number; o: number }[]): { hours: number[]; total: number; refused: number; own: number } {
  const hours = Array.from({ length: 24 }, () => 0);
  let total = 0;
  let refused = 0;
  let own = 0;
  for (const r of rows) {
    const h = Number(r.h);
    if (h >= 0 && h < 24) hours[h] += Number(r.n) || 0;
    total += Number(r.n) || 0;
    refused += Number(r.r) || 0;
    own += Number(r.o) || 0;
  }
  return { hours, total, refused, own };
}

/** The last `bytes` of a file (whole lines only), "" when it cannot be read. */
async function tail(file: string, bytes = 256 * 1024): Promise<string> {
  try {
    const fh = await open(/*turbopackIgnore: true*/ file, "r");
    try {
      const size = (await fh.stat()).size;
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      const text = buf.toString("utf8");
      return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
}

const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ALLOWED = "verdict LIKE 'allowed%'";

async function sqlite(db: string, sql: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await run("/usr/bin/sqlite3", ["-readonly", "-json", "-cmd", ".timeout 2000", `file:${db}?mode=ro`, sql], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

/** One query for everything the card needs from the database: one spawn per bot per refresh. */
function cardSql(today: string, own: string, stall = true): string {
  return `SELECT
  (SELECT json_object('ts', ts, 'status', status, 'last_progress_at', last_progress_at, 'model_failures', model_failures,
          'current_question', current_question, 'next_planned', next_planned, 'current_url', current_url${stall ? ", 'stall_minutes', stall_minutes" : ""}) FROM heartbeat ORDER BY id DESC LIMIT 1) AS hb,
  (SELECT json_group_array(json_object('h', h, 'n', n, 'r', r, 'o', o)) FROM (
     SELECT substr(ts, 12, 2) AS h, COUNT(*) AS n, SUM(NOT (${ALLOWED})) AS r, SUM((${ALLOWED}) AND (${own})) AS o
       FROM actions WHERE ts >= ${sq(today)} GROUP BY 1)) AS hours,
  (SELECT json_object('ts', ts, 't', action_type, 'p', payload, 'r', substr(result, 1, 400)) FROM actions WHERE ${ALLOWED} ORDER BY id DESC LIMIT 1) AS last,
  (SELECT thought FROM actions WHERE thought IS NOT NULL AND thought != '' ORDER BY id DESC LIMIT 1) AS thought,
  (SELECT json_group_array(question) FROM (SELECT question FROM questions WHERE status = 'open' ORDER BY times_pursued DESC, id DESC LIMIT 3)) AS questions,
  (SELECT json_group_array(topic) FROM (SELECT topic FROM interests ORDER BY weight DESC LIMIT 3)) AS interests,
  (SELECT json_group_array(json_object('ts', ts, 't', action_type, 'p', payload)) FROM (
     SELECT ts, action_type, payload FROM actions WHERE ${ALLOWED} AND (${own}) ORDER BY id DESC LIMIT 30)) AS feed`;
}

const json = <T>(v: unknown, dflt: T): T => {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) ?? dflt : dflt;
  } catch {
    return dflt;
  }
};

/** Everything on one bot's card. `own` is its own-output SQL (null: no kind of its own; the feed then skips it). */
export async function boardBot(
  bot: { slug: string; name: string; handle: string },
  ws: string,
  db: string | null,
  own: { label: string; where: string } | null,
  now: number,
  restarting = false,
): Promise<BotCard> {
  const today = `${localIso(now).slice(0, 10)}T00:00:00`;
  const [rows, jsonl, plan, blocks, paused, hold] = await Promise.all([
    // an engine before cb57a61 has no stall_minutes column: ask again without it
    db ? sqlite(db, cardSql(today, own?.where ?? "0")).catch(() => sqlite(db, cardSql(today, own?.where ?? "0", false))).catch(() => []) : Promise.resolve([]),
    tail(path.join(ws, "logs", "explorer.jsonl")),
    readFile(/*turbopackIgnore: true*/ path.join(ws, "plan.json"), "utf8").then((t) => JSON.parse(t) as unknown, () => null),
    readFile(/*turbopackIgnore: true*/ path.join(ws, "day-blocks.json"), "utf8").then(
      (t) => {
        const d = JSON.parse(t) as { date?: string; blocks?: Record<string, unknown> };
        return d.date === today.slice(0, 10) && d.blocks ? Object.keys(d.blocks).length : 0;
      },
      () => 0,
    ),
    readFile(/*turbopackIgnore: true*/ path.join(ws, "PAUSE"), "utf8").then(
      (t) => ({ on: true, until: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t.trim()) ? t.trim() : "" }),
      () => ({ on: false, until: "" }),
    ),
    readFile(/*turbopackIgnore: true*/ path.join(ws, "HOLD"), "utf8").then(
      (t) => {
        const h = JSON.parse(t) as { mode?: string; until?: number; why?: string };
        return { mode: String(h.mode ?? ""), until: Number(h.until ?? 0), why: one(h.why) };
      },
      () => null,
    ),
  ]);
  const r = rows[0] ?? {};
  const hb = json<Hb | null>(r.hb, null);
  const h = hourly(json(r.hours, []));
  const last = json<{ ts: string; t: string; p: string; r: string | null } | null>(r.last, null);
  const feed = own ? json<{ ts: string; t: string; p: string }[]>(r.feed, []) : [];
  return {
    slug: bot.slug,
    name: bot.name,
    handle: bot.handle,
    state: stateOf({ hb, events: parseEvents(jsonl), now, dayBlocks: blocks, paused: paused.on, pauseUntil: paused.until, hold, restarting }),
    on: nowOn(plan, hb?.current_question ?? null, typeof r.thought === "string" ? r.thought : null),
    onKind: onKindOf(plan, hb?.current_question ?? null, typeof r.thought === "string" ? r.thought : null),
    last: last ? { ts: last.ts, words: actionWords(last.t, last.p), ago: ago(last.ts, now), screen: screenOf(last.t, last.p, last.r, hb?.current_url ?? null) } : null,
    output: own ? { label: own.label, today: h.own } : null,
    refusedShare: h.total ? h.refused / h.total : null,
    actionsToday: h.total,
    hours: h.hours,
    questions: json<string[]>(r.questions, []).map((x) => clip(one(x), 160)),
    interests: json<string[]>(r.interests, []).map((x) => clip(one(x), 60)),
    model: lastModel(jsonl),
    feed: feed.map((f) => ({ slug: bot.slug, name: bot.name, ts: f.ts, words: actionWords(f.t, f.p) })),
  };
}

/** The newest `n` items across the family, newest first. */
export function mergeFeed(cards: { feed: FeedItem[] }[], n = 30): FeedItem[] {
  return cards
    .flatMap((c) => c.feed)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, n);
}

// ---- Over the shoulder: a large view of one bot, opened from its desk ----

const SHOT_FRESH_MS = 10 * 60_000;
export type TracePage = { url: string; domain: string; title: string; text: string };
export type FeedRow = { ts: string; type: string; words: string; verdict: "allowed" | "refused" | "failed"; reason: string; thought: string };
export type Shoulder = { shot: { at: string } | null; page: TracePage | null; feed: FeedRow[]; thought: string };

/** The page in a trace's prompt ("## Current page" / URL: / Title: / Text:), as the bot read it; null when none is open. */
export function tracePage(prompt: string, maxText = 6000): TracePage | null {
  const i = prompt.indexOf("## Current page");
  if (i < 0) return null;
  const end = prompt.indexOf("\n## ", i + 5);
  const sec = prompt.slice(i, end < 0 ? undefined : end);
  const url = /^URL:\s*(\S+)/m.exec(sec)?.[1] ?? "";
  if (!/^https?:\/\//.test(url)) return null;
  const title = one(/^Title:\s*(.*)$/m.exec(sec)?.[1] ?? "");
  const t = sec.indexOf("\nText:");
  const text = t < 0 ? "" : sec.slice(t + 6).replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText);
  return { url, domain: host(url), title, text };
}

/** Action rows -> the feed: words, the verdict as one word, the refusal or failure reason, the thought. */
export function feedRows(rows: { ts: string; action_type: string; payload: string | null; verdict: string; thought: string | null }[]): FeedRow[] {
  return rows.map((r) => {
    const v = r.verdict ?? "";
    const verdict = v.startsWith("allowed") ? "allowed" : v.startsWith("failed") ? "failed" : "refused";
    return {
      ts: r.ts,
      type: r.action_type,
      words: actionWords(r.action_type, r.payload),
      verdict,
      reason: verdict === "allowed" ? "" : clip(one(v.replace(/^(rejected|failed):\s*/, "")), 400),
      thought: clip(one(r.thought), 400),
    };
  });
}

/** The newest trace file (traces/<day>/<HHMMSS>-<cycle>-<action>.json) from today or yesterday, or "". */
async function newestTrace(ws: string, now: number): Promise<string> {
  for (const day of [localIso(now).slice(0, 10), localIso(now - 86400e3).slice(0, 10)]) {
    const dir = path.join(ws, "traces", day);
    const names = await readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[]);
    const newest = names.filter((n) => n.endsWith(".json")).sort().pop();
    if (newest) return path.join(dir, newest);
  }
  return "";
}

/** The screenshot path when the engine drew one in the last 10 minutes (it deletes it for a text-only page). */
export async function freshShot(ws: string, now: number): Promise<{ file: string; at: string } | null> {
  const file = path.join(ws, "screenshots", "current.png");
  const st = await stat(/*turbopackIgnore: true*/ file).catch(() => null);
  return st && now - st.mtimeMs < SHOT_FRESH_MS ? { file, at: localIso(st.mtimeMs) } : null;
}

/** Everything the over-the-shoulder view shows for one bot. */
export async function shoulder(ws: string, db: string | null, now: number): Promise<Shoulder> {
  const [shot, trace, rows] = await Promise.all([
    freshShot(ws, now),
    newestTrace(ws, now).then((f) => (f ? readFile(/*turbopackIgnore: true*/ f, "utf8").then((t) => JSON.parse(t) as { prompt?: string }, () => null) : null)),
    db
      ? sqlite(db, "SELECT ts, action_type, payload, verdict, thought FROM actions ORDER BY id DESC LIMIT 20").catch(() => [])
      : Promise.resolve([]),
  ]);
  const feed = feedRows(rows as never);
  return {
    shot: shot ? { at: shot.at } : null,
    page: trace?.prompt ? tracePage(trace.prompt) : null,
    feed,
    thought: feed.find((f) => f.thought)?.thought ?? "",
  };
}
