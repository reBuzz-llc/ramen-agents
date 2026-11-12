// The home page's live family board (creatorCC queue 16, 2026-10-30, owner: "first change the home page to a live board
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
type RestFile = { until: string; why: string; reason: string };

const NO_HEARTBEAT_MIN = 10; // at least; a slow bot gets two of its cycles (see stateOf)
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
export function stateOf(i: { hb: Hb | null; events: Ev[]; now: number; dayBlocks: number; paused: boolean; pauseUntil?: string; hold: Hold; restarting?: boolean; rest?: RestFile | null }): State {
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
  // A rest in progress: the engine keeps workspace/rest-until.json exactly while it runs, through a restart (engine
  // 158c746: the log then says rest_resumed, not resting), and removes it when a message wakes the bot early.
  const fileEnd = i.rest ? new Date(i.rest.until).getTime() : NaN;
  if (i.rest && Number.isFinite(fileEnd) && fileEnd > now) {
    const why = i.rest.why === "day_block_rest" ? `${i.dayBlocks || 3} things blocked today` : restWhy(i.rest.reason);
    return { word: `resting until ${hhmm(fileEnd)}`, tone: "muted", why };
  }
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
  // A bot beats once a cycle: silent for two cycles is "no heartbeat", never under 10 minutes. The engine's stall_minutes
  // is max(15, 3 x cycle), so for a slow bot it gives the cycle (queue 38: Scout, 600 s a cycle, read "no heartbeat"
  // between two normal beats 10.5 minutes apart).
  const noBeat = Math.max(NO_HEARTBEAT_MIN, ((hb?.stall_minutes ?? 0) * 2) / 3);
  if (silent > noBeat) return { word: `no heartbeat ${minWords(silent)}`, tone: "bad", why: `last sign ${hhmm(Math.max(...signs))}` };
  if (hb?.status === "quiet") return { word: "quiet", tone: "muted", why: one(hb.next_planned) };
  if (hb?.status === "paused") return { word: "paused", tone: "muted", why: "" };
  // queue 49: one or two failed calls are normal noise the chain retries (14:04-14:07 on 10-31, five screens went red on
  // one empty reply each); the red state takes three in a row, or the provider outage rule (board-read)
  if (hb?.status === "model_failure" && hb.model_failures >= MODEL_FAILURES_RED)
    return { word: "blocked on the model provider", tone: "warn", why: `${hb.model_failures} failed calls in a row` };
  if (hb?.status === "model_failure") return { word: "working", tone: "good", why: retrying(hb.model_failures) };
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

/** An action in words: "opened examplebrows.com", "listed lead 'Marlo'". */
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
  model: { label: string; ts: string } | null; // the provider/model its last call used, from its newest trace (queue 49)
  feed: FeedItem[];
  // queue 287: the screen's activity feed (newest first, ACTIVITY_LINES at most) and its newest refusal, in words with
  // the reason, for a stuck member's first line
  activity: ActivityLine[];
  refusal: { ts: string; words: string; reason: string } | null;
  // the newest action whatever its verdict (queue 40: the world animates what really happened) and how many refusals
  // in a row end its log
  act: Act | null;
  refusedRun: number;
  cycleSec: number | null; // seconds between its steps (queue 52: pranks between steps)
  failing: number; // failed model calls in a row now (0 unless its heartbeat says model_failure; queue 49)
  sent: FamilyMessage[]; // its last 5 allowed messages (queue 46); board-read merges them into Board.messages
  // the world's screen (creatorCC queue 233, the owner's four lines): the row or item it is on (its newest write of the
  // last hour, e.g. "Fiesta Lounge · Draft email"; "" = the screen shows its page or search), its last model call's age,
  // the last 30 minutes' allowed/all actions, and its daily goal when common-data/daily-goals.json names one
  item: string;
  modelAgo: string;
  window: { allowed: number; total: number };
  goal: number | null;
};
export const MODEL_FAILURES_RED = 3;
export const retrying = (n: number) => `${Math.max(1, n)} failed call${n > 1 ? "s" : ""}, retrying`;
/** The provider outage rule (the health banner's: the main provider failing since first_fail): a bot with any failed
 *  call in a row shows the red state then, whatever its count. */
export function withOutage<C extends { state: State; failing: number }>(card: C, outage: boolean): C {
  if (!outage || card.failing < 1 || card.state.word !== "working") return card;
  return { ...card, state: { word: "blocked on the model provider", tone: "warn", why: `${card.failing} failed call${card.failing === 1 ? "" : "s"} in a row; the provider is out` } };
}

export type Act = { id: number; ts: string; type: string; verdict: "allowed" | "refused" | "failed"; to: string; thought: string };

/** The screen's activity feed (creatorCC queue 287, the owner: the screen about the work, not the guards): a member's
 *  newest allowed actions, newest first, each in plain words with its time; "web" and "search" lines get the orange
 *  square. Never an email address or a phone number (masked), never a draft's text. */
export type ActivityLine = { ts: string; hhmm: string; words: string; kind: "web" | "search" | "other" };
export const ACTIVITY_LINES = 20;

const EMAILISH = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONEISH = /\+?\d[\d\s().-]{7,}\d/g;
/** Words for a screen: emails and phone numbers out. */
export const unpersonal = (s: string) => s.replace(EMAILISH, "…").replace(PHONEISH, "…");

/** "menu page" from https://cibao.example/menu (the last part of the path, its words), "home page" for the root. */
function pageKind(url: unknown): string {
  try {
    const u = new URL(String(url));
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const words = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_+]+/g, " ").trim();
    return words && !/^\d+$/.test(words) ? `${clip(words.toLowerCase(), 24)} page` : "home page";
  } catch {
    return "";
  }
}

/** One action as a feed line: "opened cibao-restaurant.com · menu page", "searched 'Cibao Restaurant Bronx'",
 *  "updated Fiesta Lounge · Phone", "messaged The CEO", "note: the brunch crowd", else actionWords. */
export function activityLine(type: string, payloadJson: string | null, ts: string): ActivityLine {
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(payloadJson ?? "{}") ?? {};
  } catch {
    /* words from the type alone */
  }
  const hhmm = /T(\d{2}:\d{2})/.exec(ts)?.[1] ?? "";
  let words: string;
  let kind: ActivityLine["kind"] = "other";
  if (type === "open" || type === "follow") {
    kind = "web";
    const where = host(p.url);
    const page = pageKind(p.url);
    words = where ? `opened ${where}${page ? ` · ${page}` : ""}` : actionWords(type, payloadJson);
  } else if (type === "search") {
    kind = "search";
    words = `searched ${q(p.query)}`;
  } else if (type === "update_lead") {
    const subject = subjectOf(type, payloadJson);
    words = subject ? `updated ${subject}` : actionWords(type, payloadJson);
  } else if (type === "lead") {
    words = `listed ${q(p.name)}`;
  } else if (type === "message") {
    words = `messaged ${one(p.to) || "the family"}`;
  } else if (type === "note") {
    words = `note: ${clip(one(p.title ?? p.text), 60)}`;
  } else {
    words = actionWords(type, payloadJson);
  }
  return { ts, hhmm, words: unpersonal(words), kind };
}

/** The provider and model of the bot's last call, and when (queue 49: the log's "using <label>" line marks only a
 *  switch, so it read "last call 10:47" for a bot that drafted all afternoon): the newest decision trace,
 *  <ws>/traces/<YYYY-MM-DD>/<HHMMSS>-<cycle>-<action>.json, which records the model that answered. Null when there is
 *  none (the line is left out). */
export async function lastModel(ws: string): Promise<{ label: string; ts: string } | null> {
  const root = path.join(ws, "traces");
  const days = (await readdir(/*turbopackIgnore: true*/ root).catch(() => [] as string[])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const day of days.slice(0, 2)) {
    const files = (await readdir(/*turbopackIgnore: true*/ path.join(root, day)).catch(() => [] as string[])).filter((f) => /^\d{6}-.*\.json$/.test(f)).sort().reverse();
    for (const f of files.slice(0, 3)) {
      try {
        const t = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(root, day, f), "utf8")) as { model?: unknown; at?: unknown };
        const label = one(t.model);
        if (label) return { label, ts: typeof t.at === "string" && t.at ? t.at : `${day}T${f.slice(0, 2)}:${f.slice(2, 4)}:${f.slice(4, 6)}` };
      } catch {
        /* a trace being written: the one before it */
      }
    }
  }
  return null;
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
  (SELECT json_object('t', action_type, 'p', payload, 'r', substr(result, 1, 400)) FROM actions WHERE ${ALLOWED} AND action_type IN ('open', 'follow') ORDER BY id DESC LIMIT 1) AS page,
  (SELECT json_object('id', id, 'ts', ts, 't', action_type, 'p', substr(payload, 1, 300), 'v', substr(verdict, 1, 60), 'th', substr(thought, 1, 200)) FROM actions ORDER BY id DESC LIMIT 1) AS act,
  (SELECT COUNT(*) FROM actions WHERE id > COALESCE((SELECT MAX(id) FROM actions WHERE verdict NOT LIKE 'rejected%'), 0)) AS run,
  (SELECT json_group_array(json_object('id', id, 'ts', ts, 'p', substr(payload, 1, 400))) FROM (
     SELECT id, ts, payload FROM actions WHERE action_type = 'message' AND ${ALLOWED} ORDER BY id DESC LIMIT 5)) AS msgs,
  (SELECT thought FROM actions WHERE thought IS NOT NULL AND thought != '' ORDER BY id DESC LIMIT 1) AS thought,
  (SELECT json_group_array(question) FROM (SELECT question FROM questions WHERE status = 'open' ORDER BY times_pursued DESC, id DESC LIMIT 3)) AS questions,
  (SELECT json_group_array(topic) FROM (SELECT topic FROM interests ORDER BY weight DESC LIMIT 3)) AS interests,
  (SELECT json_group_array(json_object('ts', ts, 't', action_type, 'p', payload)) FROM (
     SELECT ts, action_type, payload FROM actions WHERE ${ALLOWED} AND (${own}) ORDER BY id DESC LIMIT 30)) AS feed,
  (SELECT json_group_array(json_object('ts', ts, 't', action_type, 'p', payload)) FROM (
     SELECT ts, action_type, payload FROM actions WHERE ${ALLOWED} ORDER BY id DESC LIMIT ${ACTIVITY_LINES})) AS activity,
  (SELECT json_object('ts', ts, 't', action_type, 'p', substr(payload, 1, 600), 'v', substr(verdict, 1, 300)) FROM actions WHERE verdict LIKE 'rejected%' ORDER BY id DESC LIMIT 1) AS refusal`;
}

const json = <T>(v: unknown, dflt: T): T => {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) ?? dflt : dflt;
  } catch {
    return dflt;
  }
};

// The family's messages (queue 46: the planes in the air): bot-to-bot, to everyone, replies to the Owner, and the
// owner's chat lines. text60: the text on one line, cut to 60 characters; text120 the same cut to 120 (queue 51: the
// card shown on a hovered or tapped butterfly or bee).
export type FamilyMessage = { id: string; ts: string; from: string; to: string; text60: string; text120: string };

/** A bot's message rows -> messages from it. A payload cut at 400 characters still gives its "to" and the text's start. */
export function sentOf(bot: { slug: string; name: string }, rows: { id: number; ts: string; p: string | null }[]): FamilyMessage[] {
  return rows.map((r) => {
    let to = "";
    let text = "";
    try {
      const o = JSON.parse(r.p ?? "{}") as { to?: unknown; text?: unknown };
      to = String(o.to ?? "");
      text = String(o.text ?? "");
    } catch {
      to = /"to":\s*"([^"]*)"/.exec(r.p ?? "")?.[1] ?? "";
      text = /"text":\s*"((?:[^"\\]|\\.)*)/.exec(r.p ?? "")?.[1]?.replace(/\\(.)/g, "$1") ?? "";
    }
    return { id: `${bot.slug}:${r.id}`, ts: r.ts, from: bot.name, to: one(to) || "everyone", text60: clip(one(text), 60), text120: clip(one(text), 120) };
  });
}

/** The family's newest messages, newest first: every bot's own plus the owner's chat lines to each, `limit` in all. */
export function familyMessages(sent: FamilyMessage[], owner: { slug: string; name: string; ts: string; text: string }[], limit = 5): FamilyMessage[] {
  const lines = owner.map((l) => ({ id: `owner:${l.slug}:${l.ts}`, ts: l.ts, from: "Owner", to: l.name, text60: clip(one(l.text), 60), text120: clip(one(l.text), 120) }));
  return [...sent, ...lines].sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id)).slice(0, limit);
}

/** The newest action as the world animates it: its type, its verdict in a word, whom a message went to, its thought. */
function actOf(a: { id: number; ts: string; t: string; p: string | null; v: string | null; th: string | null } | null): Act | null {
  if (!a) return null;
  let to = "";
  try {
    to = String((JSON.parse(a.p ?? "{}") as { to?: unknown }).to ?? "");
  } catch {
    /* a payload cut at 300 characters: look for the field */
    to = /"to":\s*"([^"]*)"/.exec(a.p ?? "")?.[1] ?? "";
  }
  const v = a.v ?? "";
  return { id: Number(a.id), ts: a.ts, type: a.t, verdict: /^allowed/i.test(v) ? "allowed" : /^rejected/i.test(v) ? "refused" : "failed", to, thought: one(a.th) };
}

/** A read or back names no page: it is on the page the bot last opened or followed, so it takes that page's domain and
 *  title (queue 38, as /api/web does for its list). */
function onPage(sc: Screen, page: { t: string; p: string | null; r: string | null } | null): Screen {
  if (sc.kind !== "web" || sc.domain || !page) return sc;
  const was = screenOf(page.t, page.p, page.r, null);
  return { ...sc, domain: was.domain, title: sc.title || was.title };
}

// What a member is on, by the write that names it (queue 233). The Lead Gen and anyone not listed show their page or
// search; the Analyst its open question.
const SUBJECT: Record<string, string[]> = {
  "outreach-writer": ["update_lead"],
  "lead-enricher": ["update_lead"],
  scout: ["provider"],
  "package-designer": ["package", "message"],
  "the-ceo": ["update_task", "message", "propose"],
};
const CELLS: Record<string, string> = {
  draft_email: "Draft email",
  draft_whatsapp: "Draft WhatsApp",
  pain_point: "Pain point",
  how_we_help: "How can I help",
  email: "Email",
  website: "Website",
  whatsapp: "WhatsApp",
  phone: "Phone",
  location: "Location",
  industry: "Industry",
  founded_by: "Founded by",
  contact_role: "Contact role",
  size: "Size",
  evidence: "Evidence",
};

/** The item a write names: "<lead> · <cells it filled>", a provider's or package's name, "to <peer>: <text>", a task. */
export function subjectOf(type: string, payload: string | null): string {
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(payload ?? "{}") as Record<string, unknown>;
  } catch {
    return "";
  }
  const name = one(p.name);
  if (type === "update_lead") {
    const cells = Object.keys(CELLS).filter((k) => p[k] !== null && p[k] !== undefined && p[k] !== "").map((k) => CELLS[k]);
    return name ? [name, cells.slice(0, 2).join(", ")].filter(Boolean).join(" · ") : "";
  }
  if (type === "message") return p.to ? `to ${one(p.to)}: ${one(p.text)}` : "";
  if (type === "update_task" || type === "propose") return one(p.title ?? p.task ?? p.change ?? p.name ?? "");
  return name;
}

/** Everything on one bot's card. `own` is its own-output SQL (null: no kind of its own; the feed then skips it). */
export async function boardBot(
  bot: { slug: string; name: string; handle: string; cycleSec?: number },
  ws: string,
  db: string | null,
  own: { label: string; where: string } | null,
  now: number,
  restarting = false,
): Promise<BotCard> {
  const today = `${localIso(now).slice(0, 10)}T00:00:00`;
  const types = SUBJECT[bot.slug] ?? [];
  const since = localIso(now - 30 * 60_000).slice(0, 19);
  const hourAgo = localIso(now - 60 * 60_000).slice(0, 19);
  const subjectSql = `SELECT (SELECT json_object('t', action_type, 'p', payload) FROM actions WHERE verdict LIKE 'allowed%' AND ts >= '${hourAgo}'${
    types.length ? ` AND action_type IN (${types.map((t) => `'${t}'`).join(",")})` : " AND 0"
  } ORDER BY id DESC LIMIT 1) AS subj, (SELECT json_array(COALESCE(SUM(verdict LIKE 'allowed%'), 0), COUNT(*)) FROM actions WHERE ts >= '${since}') AS win`;
  const [extra, goals] = await Promise.all([
    db ? sqlite(db, subjectSql).catch(() => []) : Promise.resolve([]),
    readFile(/*turbopackIgnore: true*/ path.join(ws, "..", "..", "common-data", "daily-goals.json"), "utf8").then((t) => JSON.parse(t) as Record<string, unknown>, () => ({}) as Record<string, unknown>),
  ]);
  const x = (extra[0] ?? {}) as Record<string, unknown>;
  const subj = json<{ t: string; p: string | null } | null>(x.subj, null);
  const win = json<[number, number]>(x.win, [0, 0]);
  const goal = Number((goals as Record<string, unknown>)[bot.slug]);
  const [rows, jsonl, plan, blocks, paused, hold, rest, model] = await Promise.all([
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
    readFile(/*turbopackIgnore: true*/ path.join(ws, "rest-until.json"), "utf8").then(
      (t): RestFile => {
        const d = JSON.parse(t) as Record<string, unknown>;
        return { until: String(d.until ?? ""), why: String(d.why ?? ""), reason: one(d.reason) };
      },
      () => null,
    ),
    lastModel(ws).catch(() => null),
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
    state: stateOf({ hb, events: parseEvents(jsonl), now, dayBlocks: blocks, paused: paused.on, pauseUntil: paused.until, hold, restarting, rest }),
    on: nowOn(plan, hb?.current_question ?? null, typeof r.thought === "string" ? r.thought : null),
    onKind: onKindOf(plan, hb?.current_question ?? null, typeof r.thought === "string" ? r.thought : null),
    last: last ? { ts: last.ts, words: actionWords(last.t, last.p), ago: ago(last.ts, now), screen: onPage(screenOf(last.t, last.p, last.r, hb?.current_url ?? null), json(r.page, null)) } : null,
    output: own ? { label: own.label, today: h.own } : null,
    refusedShare: h.total ? h.refused / h.total : null,
    actionsToday: h.total,
    hours: h.hours,
    questions: json<string[]>(r.questions, []).map((x) => clip(one(x), 160)),
    interests: json<string[]>(r.interests, []).map((x) => clip(one(x), 60)),
    model,
    feed: feed.map((f) => ({ slug: bot.slug, name: bot.name, ts: f.ts, words: actionWords(f.t, f.p) })),
    activity: json<{ ts: string; t: string; p: string }[]>(r.activity, []).map((a) => activityLine(a.t, a.p, a.ts)),
    refusal: refusalOf(json(r.refusal, null)),
    act: actOf(json(r.act, null)),
    refusedRun: Number(r.run) || 0,
    cycleSec: bot.cycleSec ?? null,
    failing: hb?.status === "model_failure" ? Number(hb.model_failures) || 1 : 0,
    sent: sentOf(bot, json(r.msgs, [])),
    item: subj ? clip(subjectOf(subj.t, subj.p), 160) : "",
    modelAgo: model ? ago(model.ts, now) : "",
    window: { allowed: Number(win[0]) || 0, total: Number(win[1]) || 0 },
    goal: Number.isFinite(goal) && goal > 0 ? goal : null,
  };
}

/** The newest refusal in words and its reason ("rejected: <why>" in the log), emails and phones out. */
function refusalOf(r: { ts: string; t: string; p: string | null; v: string | null } | null): BotCard["refusal"] {
  if (!r) return null;
  return { ts: r.ts, words: unpersonal(actionWords(r.t, r.p)), reason: unpersonal(clip(one((r.v ?? "").replace(/^rejected:\s*/i, "")), 160)) };
}

/** The newest `n` items across the family, newest first. */
export function mergeFeed(cards: { feed: FeedItem[] }[], n = 30): FeedItem[] {
  return cards
    .flatMap((c) => c.feed)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, n);
}

// ---- Over the shoulder (creatorCC queue 22): a large view of one bot, opened from its desk ----

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

// ---- The family's web activity (queue 33): the WEB terminal in the world shows what the bots really browsed ----
// From each running bot's actions table: open, follow, read and back are pages, search a search. A row is marked
// refused (verdict "rejected…"), captcha (Cloudflare, a 403 or a captcha in the verdict or result), empty (an empty
// page or 0 chars) or ok, in that order.
const WEB_TYPES = "('open','follow','read','back','search')";
type WebMark = "ok" | "refused" | "captcha" | "empty";
export type WebEvent = { slug: string; name: string; ts: string; ago: string; kind: "web" | "search"; domain: string; title: string; query: string; mark: WebMark; reason: string };
export type WebToday = { opens: number; searches: number; refused: number };
export type WebPage = { slug: string; name: string; ts: string; ago: string; domain: string; title: string; url: string; shot: string | null };
export type WebData = { at: string; events: WebEvent[]; today: WebToday; perBot: Record<string, { lastTs: string; domain: string }>; recent_pages: WebPage[] };
type Deny = { domains: string[]; paths: string[] };

/** common-data/denylist.txt: "domain:<host>" blocks the host and its subdomains, "path:<segment>" any path holding it. */
export function parseDenylist(text: string): Deny {
  const out: Deny = { domains: [], paths: [] };
  for (const raw of text.split("\n")) {
    const l = raw.trim().toLowerCase();
    if (l.startsWith("domain:")) out.domains.push(l.slice(7).trim());
    else if (l.startsWith("path:")) out.paths.push(l.slice(5).trim());
  }
  return out;
}

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|startpage|ecosia|brave|searx[a-z]*|search)\./;

/** A page the owner would approve on the floating screens (queue 39): an allowed open or follow of an http(s) page with
 *  a title and at least 500 characters read, nothing refused, blocked or empty about it, not on the denylist, and not a
 *  search engine or a sign-in page. The page's address, or null when it is out. */
export function validPage(row: { t: string; p: string | null; v: string; r: string | null }, deny: Deny): string | null {
  if (row.t !== "open" && row.t !== "follow") return null;
  if (!/^allowed/i.test(row.v ?? "") || webMark(row.v ?? "", row.r) !== "ok") return null;
  const res = one(row.r);
  const m = /(?:opened|to) (https?:\/\/\S+?):? '([^']*)'?/.exec(res);
  const chars = Number((/\(([\d ]+) chars/.exec(res)?.[1] ?? "0").replace(/ /g, ""));
  if (!m || !one(m[2]) || chars < 500) return null;
  let u: URL;
  try {
    u = new URL(m[1].replace(/[),.]+$/, ""));
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const pathLow = u.pathname.toLowerCase();
  if (/login|signin|sign-in|accounts\./.test(host) || /\/(login|signin|sign-in)\b/.test(pathLow) || SEARCH_HOSTS.test(host)) return null;
  if (deny.domains.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  if (deny.paths.some((seg) => pathLow.split("/").some((part) => part.replace(/\.[a-z0-9]+$/, "") === seg))) return null;
  return u.toString();
}
type WebRow = { ts: string; t: string; p: string | null; v: string; r: string | null };

/** One query per bot: its last 20 web actions, today's counts (pages opened = open and follow allowed; searches allowed;
 *  refused), and its latest allowed web action. `today` is local midnight as the bots write ts ("2026-10-31T00:00:00"). */
function webSql(today: string): string {
  return `SELECT
  (SELECT json_group_array(json_object('ts', ts, 't', action_type, 'p', payload, 'v', substr(verdict, 1, 300), 'r', substr(result, 1, 400))) FROM (
     SELECT ts, action_type, payload, verdict, result FROM actions WHERE action_type IN ${WEB_TYPES} ORDER BY id DESC LIMIT 20)) AS recent,
  (SELECT json_object('opens', COALESCE(SUM(action_type IN ('open','follow') AND ${ALLOWED}), 0), 'searches', COALESCE(SUM(action_type = 'search' AND ${ALLOWED}), 0),
          'refused', COALESCE(SUM(verdict LIKE 'rejected%'), 0)) FROM actions WHERE action_type IN ${WEB_TYPES} AND ts >= ${sq(today)}) AS today,
  (SELECT json_object('ts', ts, 't', action_type, 'p', payload, 'v', verdict, 'r', substr(result, 1, 400)) FROM actions
     WHERE action_type IN ${WEB_TYPES} AND ${ALLOWED} ORDER BY id DESC LIMIT 1) AS latest`;
}

export function webMark(verdict: string, result: string | null): WebMark {
  const both = `${verdict} ${result ?? ""}`;
  if (/^rejected/i.test(verdict)) return "refused";
  if (/captcha|cloudflare|\b403\b/i.test(both)) return "captcha";
  if (/empty page|\(0 chars|\b0 chars\b/i.test(result ?? "")) return "empty";
  return "ok";
}

// Why a row was refused, in plain words (queue 44): the engine's standing phrases shortened; anything else is the
// verdict's own text cut to about 110 characters at a sentence end.
const REASONS: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
  [/you have read this site enough today/i, "site read enough today; blocked until tomorrow"],
  [/you searched that today; the answer did not change/i, "same search as earlier today"],
  [/already searched .* this episode/i, "same search twice in one episode"],
  [/refused or done already today/i, "refused or done earlier today; blocked until tomorrow"],
  [/blocked for this episode/i, "blocked for this episode (repeated or refused before)"],
  [/open only an address you have actually seen/i, "address typed from memory, not from a link list"],
  [/move on: (\d+) pages on (\S+) today and nothing written/i, (m) => `${m[1]} pages on ${m[2]} today, nothing written; move on`],
  [/opened or read (\d+) pages without noting/i, (m) => `${m[1]} pages read without a note`],
  [/asks bots not to read that page \(robots\.txt\)/i, "the site asks bots not to read it (robots.txt)"],
  [/episode budget used up|episode is over budget/i, "episode budget used up"],
  [/private networks and localhost/i, "private network address"],
];
const NOTE_MAX = 110;

/** The verdict text after "rejected:" in plain words, about 110 characters at most, cut at a sentence end when one is
 *  near enough (else at a word, with "…"). */
export function refusalWords(verdict: string): string {
  const text = one(verdict.replace(/^(rejected|failed):\s*/i, ""));
  for (const [re, out] of REASONS) {
    const m = re.exec(text);
    if (m) return typeof out === "string" ? out : out(m);
  }
  if (text.length <= NOTE_MAX) return text;
  const head = text.slice(0, NOTE_MAX + 1);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf(": "));
  if (end >= 40) return text.slice(0, end + (head[end] === "." ? 1 : 0));
  return text.slice(0, head.lastIndexOf(" ") > 40 ? head.lastIndexOf(" ") : NOTE_MAX).replace(/[\s,;:.-]+$/, "") + "…";
}

/** A row's note: the refusal in plain words, "captcha or access wall" or "empty page"; empty for an ok row. */
export function webReason(mark: WebMark, verdict: string): string {
  if (mark === "refused") return refusalWords(verdict) || "refused";
  if (mark === "captcha") return "captcha or access wall";
  if (mark === "empty") return "empty page";
  return "";
}

/** A row in the terminal's words: its domain and title (as the desk monitor reads them), or the search's query. */
function webEvent(bot: { slug: string; name: string }, row: WebRow, now: number): WebEvent {
  const s = screenOf(row.t, row.p, row.r, null);
  const search = row.t === "search";
  return {
    slug: bot.slug,
    name: bot.name,
    ts: row.ts,
    ago: ago(row.ts, now),
    kind: search ? "search" : "web",
    domain: search ? "" : s.domain,
    title: s.title,
    query: search ? s.title : "",
    mark: webMark(row.v ?? "", row.r),
    reason: webReason(webMark(row.v ?? "", row.r), row.v ?? ""),
  };
}

/** The family's web activity from each bot's query result: the newest 20 events across all of them, today's totals and
 *  each bot's latest allowed web action (lastTs moves on when it opened or searched something new). */
export function webData(bots: { slug: string; name: string; row: Record<string, unknown> | null }[], now: number, deny: Deny = { domains: [], paths: [] }): WebData {
  const events: WebEvent[] = [];
  const pages: WebPage[] = [];
  const today: WebToday = { opens: 0, searches: 0, refused: 0 };
  const perBot: WebData["perBot"] = {};
  for (const b of bots) {
    if (!b.row) continue;
    // a read (or back) names no page: it is on the page the bot opened before it, so it takes that one's domain and title
    const rows = json<WebRow[]>(b.row.recent, []);
    const mine = rows.map((r) => webEvent(b, r, now));
    rows.forEach((r, k) => {
      const url = validPage(r, deny);
      if (url) pages.push({ slug: b.slug, name: b.name, ts: r.ts, ago: ago(r.ts, now), domain: mine[k].domain, title: mine[k].title, url, shot: null });
    });
    for (let i = mine.length - 2; i >= 0; i--) {
      const e = mine[i];
      const before = mine[i + 1];
      if (e.kind === "web" && !e.domain && before.kind === "web" && before.domain) Object.assign(e, { domain: before.domain, title: e.title || before.title });
    }
    events.push(...mine);
    const t = json<Partial<WebToday>>(b.row.today, {});
    today.opens += Number(t.opens) || 0;
    today.searches += Number(t.searches) || 0;
    today.refused += Number(t.refused) || 0;
    const l = json<WebRow | null>(b.row.latest, null);
    if (l) perBot[b.slug] = { lastTs: l.ts, domain: l.t === "search" ? "search" : screenOf(l.t, l.p, l.r, null).domain || (mine.find((e) => e.ts <= l.ts && e.domain)?.domain ?? "") };
  }
  events.sort((a, b) => b.ts.localeCompare(a.ts));
  // the floating screens: the last 8 valid pages across the family, one per address (the newest visit wins)
  pages.sort((a, b) => b.ts.localeCompare(a.ts));
  const seen = new Set<string>();
  const recent_pages = pages.filter((p) => !seen.has(p.url) && seen.add(p.url)).slice(0, 8);
  return { at: new Date(now).toISOString(), events: events.slice(0, 20), today, perBot, recent_pages };
}

/** One bot's web rows (null when its database cannot be read). */
export async function webRow(db: string | null, now: number): Promise<Record<string, unknown> | null> {
  if (!db) return null;
  const rows = await sqlite(db, webSql(`${localIso(now).slice(0, 10)}T00:00:00`)).catch(() => []);
  return rows[0] ?? null;
}

/** A STOP file's reason: its first non-empty line, trimmed, at most 160 characters; "" for none. */
export function stopReason(text: string | null): string {
  const line = (text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
