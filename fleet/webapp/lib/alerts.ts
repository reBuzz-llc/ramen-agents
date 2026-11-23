// Server-side only: notifications. A background watcher (started from instrumentation.ts) reads every bot's
// live state and new log events every 20 s, turns the ones worth knowing about into alerts, keeps the latest
// 200 in data/alerts.json, and posts a macOS notification for the types switched on in Settings.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BotEvent, BotProfile } from "./bot";
import { dataServerUrl, fetchState, listBots } from "./bots";

const run = promisify(execFile);
const FILE = process.env.ALERTS_FILE || path.join(process.cwd(), "data", "alerts.json");
const MAX = 200;
const POLL_MS = Number(process.env.ALERTS_POLL_MS) || 20000;
const STOP_GRACE_MS = Number(process.env.ALERTS_STOP_GRACE_MS) || 90000; // launchd restarts a crashed bot within about 30 s
const STATE_COOLDOWN_MS = 30 * 60 * 1000;
// A bot is "stale" to its data server after four minutes without a heartbeat, which a slow model call
// reaches on its own: that alone flagged healthy bots as stuck all morning. Wait until its own watchdog
// (watchdog.stall_minutes, 15 by default) should already have closed the episode and recovered it; if it
// is still silent then, something is genuinely wrong.
const STUCK_AFTER_MS = Number(process.env.ALERTS_STUCK_AFTER_MS) || 15 * 60 * 1000;

const ALERT_TYPES = {
  task: { label: "Task created", detail: "A bot added a task to your Tasks board", notify: true, tile: "bg-sys-indigo", icon: "check" },
  package: { label: "Service package ready", detail: "The Package Designer handed a package to another bot", notify: true, tile: "bg-sys-orange", icon: "sparkles" },
  provider: { label: "Free provider or tool found", detail: "The Scout recorded a free AI provider, search tool, data source or verification tool", notify: true, tile: "bg-sys-purple", icon: "key" },
  say: { label: "Message from a bot", detail: "A bot wrote to you in its chat", notify: true, tile: "bg-sys-blue", icon: "chat" },
  stopped: { label: "Bot stopped unexpectedly", detail: "A bot stopped without being told to, and did not come back", notify: true, tile: "bg-sys-red", icon: "stop" },
  stuck: { label: "Bot may be stuck", detail: "No heartbeat for a while, or its watchdog gave up", notify: true, tile: "bg-sys-orange", icon: "arrow-clockwise" },
  models: { label: "Models keep failing", detail: "Three or more model failures in a row", notify: true, tile: "bg-sys-red", icon: "sparkles" },
  board: { label: "The board is down", detail: "The dashboard's board did not answer or refused the bots' key: nothing new is saved until it does", notify: true, tile: "bg-sys-red", icon: "flag" },
  message: { label: "Bot-to-bot message", detail: "One bot sent research or tips to another", notify: false, tile: "bg-sys-teal", icon: "chat" },
} as const;
type AlertType = keyof typeof ALERT_TYPES;

type Alert = { id: string; type: AlertType; bot: string; botName: string; title: string; body: string; at: string; read: boolean; href: string | null };
type Store = {
  alerts: Alert[];
  prefs: Partial<Record<AlertType, boolean>>;
  cursors: Record<string, { ts: string; seen: string[] }>;
  cooldowns: Record<string, number>;
};

// One store for the whole server. The background watcher (instrumentation.ts) and the API route load this
// module in separate bundles, so a plain module-level variable gave each of them its own copy: clearing the
// list in the route emptied one copy while the watcher still held the old one and wrote it back on its next
// tick, and every alert reappeared. The cache lives on globalThis so both share it, and is dropped whenever
// the file on disk is newer than the copy in memory (another worker, or an editor).
type Cache = { store: Store; mtimeMs: number; writing: Promise<void> };
const g = globalThis as { __alerts?: Cache };

async function fileMtime(): Promise<number> {
  try {
    return (await stat(/*turbopackIgnore: true*/ FILE)).mtimeMs;
  } catch {
    return 0;
  }
}

async function load(): Promise<Store> {
  const mtimeMs = await fileMtime();
  const cached = g.__alerts;
  if (cached && mtimeMs <= cached.mtimeMs) return cached.store;
  let store: Store;
  try {
    store = JSON.parse(await readFile(/*turbopackIgnore: true*/ FILE, "utf8")) as Store;
  } catch {
    store = { alerts: [], prefs: {}, cursors: {}, cooldowns: {} };
  }
  store.alerts ??= [];
  store.prefs ??= {};
  store.cursors ??= {};
  store.cooldowns ??= {};
  g.__alerts = { store, mtimeMs, writing: cached?.writing ?? Promise.resolve() };
  return store;
}

function save(): Promise<void> {
  const cache = g.__alerts;
  if (!cache) return Promise.resolve();
  cache.writing = cache.writing.then(async () => {
    await mkdir(/*turbopackIgnore: true*/ path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(cache.store, null, 1));
    await rename(/*turbopackIgnore: true*/ tmp, FILE);
    cache.mtimeMs = await fileMtime(); // our own write must not look like someone else's
  });
  return cache.writing;
}

function notifyOn(s: Store, type: AlertType): boolean {
  return s.prefs[type] ?? ALERT_TYPES[type].notify;
}

async function macNotify(title: string, subtitle: string, body: string): Promise<void> {
  if (process.platform !== "darwin" || process.env.ALERTS_NO_MAC) return;
  const q = (t: string) => t.replace(/\\/g, "\\\\").replace(/"/g, "'").replace(/\s+/g, " ").slice(0, 220);
  await run("/usr/bin/osascript", ["-e", `display notification "${q(body)}" with title "${q(title)}" subtitle "${q(subtitle)}" sound name "Glass"`], { timeout: 5000 }).catch(() => undefined);
}

async function add(s: Store, bot: BotProfile, type: AlertType, title: string, body: string, href: string | null): Promise<void> {
  const alert: Alert = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, type, bot: bot.slug, botName: bot.name, title, body, at: new Date().toISOString(), read: false, href };
  s.alerts = [alert, ...s.alerts].slice(0, MAX);
  if (notifyOn(s, type)) await macNotify(bot.name, title, body || ALERT_TYPES[type].label);
}

const trimQuote = (t: string | undefined, n = 140) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// The board (the dashboard's local board, or the hosted portal) not answering, or refusing the bots' key: every bot hits
// the same wall, so one alert for the whole fleet (BOARD_COOLDOWN_MS), not one per failed write. The engine rests the
// member with the plain reason and keeps the write; its all-clear takes the banner down.
const BOARD_DOWN = /board (?:is )?down|board did not answer|the portal could not be reached|portal answered HTTP 5\d\d|refused the agents' key/i;
const BOARD_COOLDOWN_MS = 12 * 3600 * 1000;

const BOARD_OK_TITLE = "The board answers again";

function boardTrouble(e: BotEvent): { type: AlertType; title: string; body: string; href: string | null } | null {
  if (e.kind === "board_restored") return { type: "board", title: BOARD_OK_TITLE, body: trimQuote(e.msg, 160), href: null };
  const text = [e.msg, e.result, e.error, e.exc, e.reason].filter(Boolean).join(" ");
  if (e.kind === "board_down" || (BOARD_DOWN.test(text) && String(e.ok) !== "true")) {
    const key = /key/i.test(text);
    return {
      type: "board",
      title: key ? "The board refused the bots' key" : "The board is down: the bots cannot save",
      body: key ? "Run sh scripts/check-setup.sh: it says which key file is missing or wrong." : "Is the dashboard running? sh scripts/check-setup.sh says what is wrong.",
      href: null,
    };
  }
  return null;
}

function fromEvent(bot: BotProfile, e: BotEvent): { type: AlertType; title: string; body: string; href: string | null } | null {
  const page = `/work-plan#${bot.slug}`; // its card; the bot pages are gone (owner, 2026-10-30)
  const board = boardTrouble(e);
  if (board) return board;
  switch (e.kind) {
    case "task":
      return { type: "task", title: "Created a task", body: trimQuote(e.title), href: e.url && /^https?:\/\//.test(e.url) ? e.url : page };
    case "package":
      return { type: "package", title: `Handed a package to ${e.to ?? "another bot"}`, body: [trimQuote(e.name, 90), e.price].filter(Boolean).join(" · "), href: page };
    case "provider":
      // Scout finds more than AI models now; the event's label says what (engine 9602b4a): "AI provider", "search tool",
      // "data source", "verification tool" or "tool". Only an AI provider is a key to add on Key providers.
      return {
        type: "provider",
        title: e.label ? `Found a free ${e.label}` : "Found a free tool or provider",
        body: [e.name, e.base_url].filter(Boolean).join(" · "),
        href: !e.category || e.category === "model" ? "/settings/providers" : `/work-plan#${bot.slug}`,
      };
    case "action":
      if (e.action === "say" && e.ok === "True" && e.result?.startsWith("told the owner:"))
        return { type: "say", title: "Sent you a message", body: trimQuote(e.result.replace(/^told the owner:\s*/, "")), href: `${page}/chat` };
      return null;
    case "message":
      return { type: "message", title: `Sent a message to ${e.to ?? "another bot"}`, body: `${e.chars ?? "?"} characters`, href: page };
    case "giving_up":
      return { type: "stuck", title: "Watchdog gave up", body: trimQuote(e.msg), href: page };
    default:
      return null;
  }
}

type Live = { running: boolean; stale: boolean; failures: number; stopSince: number | null; stopFlag: boolean };
const live = new Map<string, Live>();

async function checkBot(s: Store, bot: BotProfile): Promise<void> {
  const state = await fetchState(bot, 3000);
  if (!state) return; // data server offline: nothing reliable to say

  // Events since the cursor. The first time a bot is seen, start from now instead of replaying its history.
  let events: BotEvent[] = [];
  let fetched = false;
  try {
    const res = await fetch(dataServerUrl(bot, "/api/events?n=200"), { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      events = ((await res.json()) as BotEvent[]).filter((e) => e.kind);
      fetched = true;
    }
  } catch {
    events = [];
  }
  const cursor = s.cursors[bot.slug];
  const key = (e: BotEvent) => `${e.ts}|${e.msg}`;
  if (!fetched) {
    // Nothing reliable this tick. Seeding a first-seen bot from a failed fetch left an empty cursor, and the next
    // good fetch replayed its whole history as up to 200 alerts: wait for a real answer instead.
  } else if (!cursor || !cursor.ts) {
    const lastTs = events.at(-1)?.ts ?? "";
    s.cursors[bot.slug] = { ts: lastTs, seen: events.filter((e) => e.ts === lastTs).map(key) };
  } else {
    const fresh = events.filter((e) => e.ts > cursor.ts || (e.ts === cursor.ts && !cursor.seen.includes(key(e))));
    for (const e of fresh) {
      const a = fromEvent(bot, e);
      if (!a) continue;
      if (a.type === "board" && a.title !== BOARD_OK_TITLE) {
        // Fleet-wide: every bot hits the same wall, and every retry would be another alert.
        if (Date.now() - (s.cooldowns["fleet:board"] ?? 0) < BOARD_COOLDOWN_MS) continue;
        s.cooldowns["fleet:board"] = Date.now();
      }
      await add(s, bot, a.type, a.title, a.body, a.href);
    }
    if (fresh.length) {
      const lastTs = fresh.at(-1)!.ts;
      const same = events.filter((e) => e.ts === lastTs).map(key);
      s.cursors[bot.slug] = { ts: lastTs, seen: lastTs === cursor.ts ? [...new Set([...cursor.seen, ...same])] : same };
    }
  }

  // State changes.
  const prev = live.get(bot.slug);
  const now = Date.now();
  const stopFlag = state.flags.includes("STOP");
  const failures = state.heartbeat?.model_failures ?? 0;
  const next: Live = { running: state.running, stale: state.running && state.stale, failures, stopSince: prev?.stopSince ?? null, stopFlag };
  const cooled = (type: AlertType) => now - (s.cooldowns[`${bot.slug}:${type}`] ?? 0) > STATE_COOLDOWN_MS;
  const mark = (type: AlertType) => (s.cooldowns[`${bot.slug}:${type}`] = now);

  if (prev) {
    if (prev.running && !state.running && !stopFlag) next.stopSince = now;
    if (state.running || stopFlag) next.stopSince = null;
    if (next.stopSince && now - next.stopSince > STOP_GRACE_MS && cooled("stopped")) {
      await add(s, bot, "stopped", "Stopped unexpectedly", "It stopped without a STOP flag and has not restarted. Restart it with scripts/restart-bot.sh.", `/work-plan#${bot.slug}`);
      mark("stopped");
      next.stopSince = null;
    }
    const silentFor = (state.heartbeat_age ?? 0) * 1000;
    if (next.stale && silentFor >= STUCK_AFTER_MS && cooled("stuck")) {
      await add(s, bot, "stuck", "May be stuck", `No fresh heartbeat for ${Math.round(silentFor / 60000)} minutes, and its own watchdog has not recovered it.`, `/bots/${bot.slug}`);
      mark("stuck");
    }
    if (prev.failures < 3 && failures >= 3 && cooled("models")) {
      await add(s, bot, "models", "Models keep failing", `${failures} model failures in a row. Check Settings > Key providers.`, "/settings/providers");
      mark("models");
    }
  }
  live.set(bot.slug, next);
}

let bots: BotProfile[] = [];
let botsAt = 0;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const s = await load();
    if (Date.now() - botsAt > 60000) {
      bots = await listBots();
      botsAt = Date.now();
    }
    for (const bot of bots) await checkBot(s, bot).catch(() => undefined);
    await save();
  } finally {
    running = false;
  }
}

export function startAlertWatcher(): void {
  const g = globalThis as { __alertWatcher?: boolean };
  if (g.__alertWatcher) return;
  g.__alertWatcher = true;
  void tick();
  setInterval(() => void tick(), POLL_MS).unref();
}

export async function alertsView() {
  const s = await load();
  return {
    alerts: s.alerts.slice(0, 100),
    // A type switched off is muted, not deleted: it stays in the list behind a toggle, and never counts
    // as something the owner has to look at.
    unread: s.alerts.filter((a) => !a.read && notifyOn(s, a.type)).length,
    types: Object.entries(ALERT_TYPES).map(([key, t]) => ({ key, label: t.label, detail: t.detail, tile: t.tile, icon: t.icon, notify: notifyOn(s, key as AlertType) })),
  };
}
export type AlertsView = Awaited<ReturnType<typeof alertsView>>;

export async function markAllRead(): Promise<void> {
  const s = await load();
  s.alerts = s.alerts.map((a) => (a.read ? a : { ...a, read: true }));
  await save();
}

export async function setNotify(type: string, on: boolean): Promise<boolean> {
  if (!(type in ALERT_TYPES)) return false;
  const s = await load();
  s.prefs[type as AlertType] = on;
  await save();
  return true;
}

export async function sendTest(): Promise<void> {
  await macNotify("Bots", "Notifications are on", "This is how alerts from your bots will look.");
}

export async function clearAll(): Promise<void> {
  const s = await load();
  s.alerts = [];
  await save();
}
