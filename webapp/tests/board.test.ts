// Run: npm test. The home board's state words, words for actions, the plan line and the feed, on fixtures
// (creatorCC queue 16, 2026-10-30).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-ignore TS5097
import { actionWords, ago, boardBot, familyMessages, hourly, lastModel, withOutage, mergeFeed, nowOn, parseEvents, refusalWords, sentOf, stateOf, stopReason, validPage, webReason, parseDenylist, webData, webMark, webRow, type Hb, subjectOf } from "../lib/board.ts";

const NOW = new Date(2026, 9, 30, 14, 30, 0).getTime();
const at = (hm: string) => `2026-10-30T${hm}:00`;
const ev = (hm: string, kind: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ts: at(hm), level: "INFO", msg: kind, kind, ...extra });
const hb = (hm: string, status = "running", progress = hm, extra: Partial<Hb> = {}): Hb => ({
  ts: at(hm),
  status,
  last_progress_at: at(progress),
  model_failures: 0,
  current_question: null,
  next_planned: null,
  ...extra,
});
const base = { now: NOW, dayBlocks: 0, paused: false, hold: null };
const word = (i: Partial<Parameters<typeof stateOf>[0]> & { hb: Hb | null; jsonl?: string[] }) =>
  stateOf({ ...base, ...i, events: parseEvents((i.jsonl ?? []).join("\n")) });

test("state: working", () => {
  const s = word({ hb: hb("14:29"), jsonl: [ev("14:29", "action")] });
  assert.deepEqual(s, { word: "working", tone: "good", why: "" });
});

test("state: resting until HH:MM with why (work list empty), and day-block rest with the count", () => {
  const s = word({ hb: hb("14:10"), jsonl: [ev("14:09", "action"), ev("14:10", "resting", { reason: "the work list is empty, today's tasks (1) and messages (20) are done", minutes: 30 })] });
  assert.deepEqual(s, { word: "resting until 14:40", tone: "muted", why: "work list empty" });
  const d = word({ hb: hb("14:20"), dayBlocks: 12, jsonl: [ev("14:20", "day_block_rest", { minutes: 30 })] });
  assert.deepEqual(d, { word: "resting until 14:50", tone: "muted", why: "12 things blocked today" });
});

test("state: a rest that ended, or that a message cut short, is not resting", () => {
  assert.equal(word({ hb: hb("14:29"), jsonl: [ev("13:00", "resting", { reason: "x", minutes: 30 }), ev("14:29", "action")] }).word, "working");
  assert.equal(word({ hb: hb("14:29"), jsonl: [ev("14:10", "resting", { reason: "x", minutes: 30 }), ev("14:12", "action")] }).word, "working");
});

test("state: quiet with its reason, until quiet_over", () => {
  assert.deepEqual(word({ hb: hb("14:29", "quiet", "14:00", { next_planned: "Steam is in front" }), jsonl: [ev("13:00", "quiet", { reason: "Steam is in front" })] }), {
    word: "quiet",
    tone: "muted",
    why: "Steam is in front",
  });
  assert.equal(word({ hb: hb("14:29"), jsonl: [ev("13:00", "quiet", { reason: "Steam" }), ev("14:00", "quiet_over", { minutes: 60 }), ev("14:29", "action")] }).word, "working");
});

test("state: blocked on The CEO's hold, on the model provider; paused by the owner; waiting for a task", () => {
  const until = new Date(2026, 9, 30, 16, 0, 0).getTime() / 1000;
  assert.deepEqual(word({ hb: hb("14:29"), hold: { mode: "pause", until, why: "too many repeats" } }), {
    word: "blocked on The CEO's hold",
    tone: "warn",
    why: "until 16:00: too many repeats",
  });
  assert.equal(word({ hb: hb("14:29"), hold: { mode: "slow", until, why: "" } }).word, "working");
  assert.deepEqual(word({ hb: hb("14:28", "model_failure", "14:20", { model_failures: 3 }) }), { word: "blocked on the model provider", tone: "warn", why: "3 failed calls in a row" });
  assert.equal(word({ hb: hb("14:29"), paused: true }).word, "paused");
  assert.deepEqual(word({ hb: hb("14:00"), restarting: true }), { word: "restarting", tone: "muted", why: "back in a minute" });
  assert.deepEqual(word({ hb: hb("14:29"), paused: true, pauseUntil: "2026-10-30T16:00:00" }), { word: "paused", tone: "muted", why: "until 16:00" });
  // past its time the engine works again (the file stays): not paused
  assert.equal(word({ hb: hb("14:29"), paused: true, pauseUntil: "2026-10-30T14:00" }).word, "working");
  assert.equal(word({ hb: hb("14:29", "idle (waiting for a task in chat)") }).word, "waiting for a task");
});

test("state: stalled (no progress for 15 min while ticking)", () => {
  assert.deepEqual(word({ hb: hb("14:28", "running", "14:05") }), { word: "stalled", tone: "bad", why: "no progress for 25 min" });
});

test("state: stalled uses the bot's own stall_minutes from the heartbeat (queue 29: a 30-minute bot like Scout)", () => {
  // Scout at its 10-minute pace: 25 min without progress is not a stall for it, 32 min is
  assert.equal(word({ hb: hb("14:28", "running", "14:05", { stall_minutes: 30 }) }).word, "working");
  assert.deepEqual(word({ hb: hb("14:28", "running", "13:58", { stall_minutes: 30 }) }), { word: "stalled", tone: "bad", why: "no progress for 32 min" });
  // no column (an engine before cb57a61): the old 15 minutes
  assert.equal(word({ hb: hb("14:28", "running", "14:05", { stall_minutes: null }) }).word, "stalled");
});

test("board: reads stall_minutes from the heartbeat row; a database without the column still reads", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "board-stall-"));
  const make = async (slug: string, withStall: boolean) => {
    const ws = path.join(dir, slug, "workspace");
    await mkdir(path.join(ws, "logs"), { recursive: true });
    await writeFile(path.join(ws, "logs", "explorer.jsonl"), ev("14:28", "action") + "\n");
    const db = path.join(ws, "explorer.sqlite3");
    const sql = [
      "CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, episode_id INTEGER, action_type TEXT, payload TEXT, thought TEXT, verdict TEXT, result TEXT, progress INTEGER DEFAULT 0);",
      `CREATE TABLE heartbeat (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, status TEXT, current_url TEXT, current_question TEXT, last_action TEXT, last_progress_at TEXT, model_failures INTEGER DEFAULT 0, next_planned TEXT, pid INTEGER${withStall ? ", stall_minutes REAL" : ""});`,
      "CREATE TABLE questions (id INTEGER PRIMARY KEY, created_at TEXT, question TEXT, status TEXT DEFAULT 'open', answered_at TEXT, answer_note_id INTEGER, times_pursued INTEGER DEFAULT 0);",
      "CREATE TABLE interests (topic TEXT PRIMARY KEY, weight REAL, updated_at TEXT);",
      withStall
        ? `INSERT INTO heartbeat(ts, cycle, status, last_progress_at, stall_minutes) VALUES ('${at("14:28")}', 1, 'running', '${at("14:05")}', 30.0);`
        : `INSERT INTO heartbeat(ts, cycle, status, last_progress_at) VALUES ('${at("14:28")}', 1, 'running', '${at("14:05")}');`,
    ].join("\n");
    execFileSync("/usr/bin/sqlite3", [db], { input: sql });
    return { ws, db };
  };
  const scout = await make("scout", true);
  const old = await make("desk-agent", false);
  const s = await boardBot({ slug: "scout", name: "Scout", handle: "scoutA" }, scout.ws, scout.db, null, NOW);
  const o = await boardBot({ slug: "desk-agent", name: "Desk Agent", handle: "deskA" }, old.ws, old.db, null, NOW);
  assert.equal(s.state.word, "working", "25 min without progress is under Scout's 30");
  assert.deepEqual(o.state, { word: "stalled", tone: "bad", why: "no progress for 25 min" });
});

test("state: The CEO's 09:29 day_block_rest is not a stall when its next episode starts (queue 30, the live lines of 10-31)", () => {
  const D = (hms: string) => `2026-10-31T${hms}`;
  const line = (hms: string, kind: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ts: D(hms), level: "INFO", msg: kind, kind, ...extra });
  const jsonl = [
    line("09:29:15", "closed_early", { episode: 1987, why: "three actions already refused or done today" }),
    line("09:29:23", "journal", { episode: 1987, notes: 0, chars: 1043 }),
    line("09:29:23", "day_block_rest", { episode: 1987, minutes: 30.0 }),
    line("09:44:27", "episode", { episode: 1988, question: null }),
  ];
  // the newest heartbeat row until 09:44:42 is the one from before the rest
  const beat: Hb = { ts: D("09:29:15"), status: "running", last_progress_at: D("09:26:56"), model_failures: 0, current_question: null, next_planned: null, stall_minutes: 15 };
  const at = (hms: string, upto: number, hb = beat) =>
    stateOf({ ...base, dayBlocks: 3, hb, now: new Date(D(hms)).getTime(), events: parseEvents(jsonl.slice(0, upto).join("\n")) });
  assert.deepEqual(at("09:44:24", 3), { word: "resting until 09:59", tone: "muted", why: "3 things blocked today" });
  assert.equal(at("09:44:28", 4).word, "working", "back at work 1 s ago, not 18 min without progress");
  // still a stall when nothing happens for 15 min after the bot went back to work
  assert.deepEqual(at("10:00:30", 4, { ...beat, ts: D("10:00:00") }), { word: "stalled", tone: "bad", why: "no progress for 16 min" });
});

test("state: no heartbeat N min; none at all", () => {
  assert.deepEqual(word({ hb: hb("14:05"), jsonl: [ev("14:05", "action")] }), { word: "no heartbeat 25 min", tone: "bad", why: "last sign 14:05" });
  assert.equal(word({ hb: hb("10:00") }).word, "no heartbeat 4 h");
  assert.deepEqual(word({ hb: null }), { word: "no heartbeat", tone: "bad", why: "none written yet" });
  // a rest outlasts the heartbeat (the engine ticks only when it starts)
  assert.match(word({ hb: hb("14:05"), jsonl: [ev("14:05", "resting", { reason: "x", minutes: 30 })] }).word, /^resting until 14:35/);
});

test("now on: the plan's task and step, else the question, else the last thought", () => {
  const plan = { task: "Process NYC candidates", status: "active", steps: [{ text: "Check pending", done: true }, { text: "Open new candidate sites", done: false }, { text: "Verify", done: false }] };
  assert.equal(nowOn(plan, "q", "t"), "Process NYC candidates · step 2 of 3: Open new candidate sites");
  assert.equal(nowOn({ ...plan, status: "done" }, "Which shops?", "t"), "Which shops?");
  assert.equal(nowOn(null, null, "  I should open  the contact page "), "I should open the contact page");
});

test("action words", () => {
  assert.equal(actionWords("open", JSON.stringify({ url: "https://www.tarynbrows.com/contact" })), "opened tarynbrows.com");
  assert.equal(actionWords("lead", JSON.stringify({ name: "Marlo" })), "listed lead 'Marlo'");
  assert.equal(actionWords("update_lead", JSON.stringify({ name: "Happy Paws", draft_email: "Hi" })), "drafted an email for 'Happy Paws'");
  assert.equal(actionWords("search", JSON.stringify({ query: "nyc florists" })), "searched 'nyc florists'");
  assert.equal(actionWords("weird_thing", "not json"), "weird thing");
  assert.equal(ago(at("14:29:20").slice(0, 19), NOW), "40 s ago");
  assert.equal(ago(at("14:27"), NOW), "3 min ago");
});

test("hourly: counts per hour, refused and own totals", () => {
  const h = hourly([{ h: "09", n: 10, r: 2, o: 1 }, { h: "14", n: 5, r: 1, o: 2 }]);
  assert.equal(h.hours[9], 10);
  assert.equal(h.hours[14], 5);
  assert.deepEqual([h.total, h.refused, h.own], [15, 3, 3]);
});

test("feed: newest 30 across the family from fixture databases, refusals and other kinds left out", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "board-"));
  const make = async (slug: string, rows: [string, string, string, string][]) => {
    const ws = path.join(dir, slug, "workspace");
    await mkdir(path.join(ws, "logs"), { recursive: true });
    await writeFile(
      path.join(ws, "logs", "explorer.jsonl"),
      [
        JSON.stringify({ ts: at("14:00"), level: "INFO", msg: "using remote/qwen2.5:7b" }),
        JSON.stringify({ ts: at("14:10"), level: "INFO", msg: "using api.z.ai/glm-4.5-flash" }),
        ev("14:20", "repaired", { provider: "gemini/gemini-flash-lite-latest" }),
        ev("14:29", "action"),
      ].join("\n") + "\n",
    );
    const db = path.join(ws, "explorer.sqlite3");
    const sql = [
      "CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, episode_id INTEGER, action_type TEXT, payload TEXT, thought TEXT, verdict TEXT, result TEXT, progress INTEGER DEFAULT 0);",
      "CREATE TABLE heartbeat (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, status TEXT, current_url TEXT, current_question TEXT, last_action TEXT, last_progress_at TEXT, model_failures INTEGER DEFAULT 0, next_planned TEXT, pid INTEGER);",
      "CREATE TABLE questions (id INTEGER PRIMARY KEY, created_at TEXT, question TEXT, status TEXT DEFAULT 'open', answered_at TEXT, answer_note_id INTEGER, times_pursued INTEGER DEFAULT 0);",
      "CREATE TABLE interests (topic TEXT PRIMARY KEY, weight REAL, updated_at TEXT);",
      "INSERT INTO questions(created_at, question, status, times_pursued) VALUES ('x', 'Which shops publish an email?', 'open', 3), ('x', 'Old one', 'answered', 9), ('x', 'Do florists list on Yelp?', 'open', 1);",
      "INSERT INTO interests VALUES ('nyc florists', 0.4, 'x'), ('bakeries', 0.9, 'x');",
      `INSERT INTO heartbeat(ts, cycle, status, last_progress_at) VALUES ('${at("14:29")}', 1, 'running', '${at("14:29")}');`,
      ...rows.map(([ts, t, p, v]) => `INSERT INTO actions(ts, cycle, action_type, payload, thought, verdict) VALUES ('${ts}', 1, '${t}', '${p.replace(/'/g, "''")}', 'thinking', '${v}');`),
    ].join("\n");
    execFileSync("/usr/bin/sqlite3", [db], { input: sql });
    return { ws, db };
  };
  const lg = await make("lead-gen", [
    [at("09:00"), "lead", '{"name":"Marlo"}', "allowed"],
    [at("14:00"), "lead", '{"name":"Refused Co"}', "rejected: not a business"],
    [at("14:10"), "open", '{"url":"https://a.com"}', "allowed"],
    [at("14:20"), "lead", '{"name":"Bloom"}', "allowed"],
  ]);
  const ra = await make("research-analyst", [[at("12:00"), "note", '{"title":"Pricing"}', "allowed"]]);
  const own = (label: string, where: string) => ({ label, where });
  const a = await boardBot({ slug: "lead-gen", name: "Lead Gen", handle: "leadA" }, lg.ws, lg.db, own("lead", "action_type = 'lead'"), NOW);
  const b = await boardBot({ slug: "research-analyst", name: "Research Analyst", handle: "resA" }, ra.ws, ra.db, own("note", "action_type = 'note'"), NOW);
  assert.equal(a.state.word, "working");
  assert.deepEqual(a.output, { label: "lead", today: 2 });
  assert.equal(a.refusedShare, 0.25);
  assert.equal(a.last?.words, "listed lead 'Bloom'");
  assert.equal(a.hours[14], 3);
  assert.deepEqual(a.questions, ["Which shops publish an email?", "Do florists list on Yelp?"]);
  assert.deepEqual(a.interests, ["bakeries", "nyc florists"]);
  assert.equal(a.model, null, "no trace: no model line (queue 49: the log's switch line is not the last call)");
  const feed = mergeFeed([a, b]);
  assert.deepEqual(
    feed.map((f: { name: string; ts: string; words: string }) => `${f.ts.slice(11, 16)} ${f.name}: ${f.words}`),
    ["14:20 Lead Gen: listed lead 'Bloom'", "12:00 Research Analyst: wrote note 'Pricing'", "09:00 Lead Gen: listed lead 'Marlo'"],
  );
  assert.equal(mergeFeed([a, b], 1).length, 1);
});

test("web activity (queue 33): open ok, open refused, search, captcha wording, empty page; today counts from local midnight", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "board-web-"));
  const db = path.join(dir, "explorer.sqlite3");
  const rows: [string, string, string, string, string][] = [
    ["2026-10-30T23:58:00", "open", '{"url":"https://yesterday.example"}', "allowed", "opened https://yesterday.example: 'Late' (100 chars)"],
    ["2026-10-31T09:00:00", "open", '{"url":"https://www.shop.example"}', "allowed", "opened https://www.shop.example: 'Shop &amp; Co | Home' (1200 chars, 9 links)"],
    ["2026-10-31T09:01:00", "open", '{"url":"https://again.example"}', "rejected: you have read this site enough today", ""],
    ["2026-10-31T09:02:00", "search", '{"query":"florists springfield"}', "allowed", "searched 'florists springfield': 'Web search results' (5000 chars, 20 links)"],
    ["2026-10-31T09:03:00", "follow", '{"link":3}', "allowed", "followed [3] to https://guarded.example/: 'Just a moment...' Cloudflare check"],
    ["2026-10-31T09:04:00", "read", '{"type":"read"}', "allowed", "read: empty page (0 chars)"],
    ["2026-10-31T09:05:00", "note", '{"title":"not web"}', "allowed", "noted"],
  ];
  const sql = [
    "CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, episode_id INTEGER, action_type TEXT, payload TEXT, thought TEXT, verdict TEXT, result TEXT, progress INTEGER DEFAULT 0);",
    ...rows.map(([ts, t, p, v, r]) => `INSERT INTO actions(ts, cycle, action_type, payload, verdict, result) VALUES ('${ts}', 1, '${t}', '${p}', '${v.replace(/'/g, "''")}', '${r.replace(/'/g, "''")}');`),
  ].join("\n");
  execFileSync("/usr/bin/sqlite3", [db], { input: sql });
  const now = new Date(2026, 9, 31, 9, 10, 0).getTime();
  const d = webData([{ slug: "lead-gen", name: "Lead Gen", row: await webRow(db, now) }, { slug: "scout", name: "Scout", row: null }], now);
  const brief = d.events.map((e: { ts: string; kind: string; domain: string; title: string; query: string; mark: string }) => [e.ts.slice(11, 16), e.kind, e.domain, e.title || e.query, e.mark]);
  assert.deepEqual(brief, [
    ["09:04", "web", "guarded.example", "Just a moment...", "empty"],
    ["09:03", "web", "guarded.example", "Just a moment...", "captcha"],
    ["09:02", "search", "", "florists springfield", "ok"],
    ["09:01", "web", "again.example", "", "refused"],
    ["09:00", "web", "shop.example", "Shop & Co | Home", "ok"],
    ["23:58", "web", "yesterday.example", "Late", "ok"],
  ]);
  assert.equal(d.events[0].name, "Lead Gen");
  assert.equal(d.events[0].ago, "6 min ago");
  // today: from local midnight only (the 23:58 open is yesterday's); pages opened = open and follow allowed
  assert.deepEqual(d.today, { opens: 2, searches: 1, refused: 1 });
  // the read at 09:04 names no page: it reads the one followed at 09:03
  assert.deepEqual(d.perBot, { "lead-gen": { lastTs: "2026-10-31T09:04:00", domain: "guarded.example" } });
  assert.equal(webMark("allowed", "opened https://x.example: 'HTTP 403 Forbidden'"), "captcha");
  assert.equal(webMark("allowed", "opened https://x.example: 'Home' (4033 chars)"), "ok", "4033 is not a 403");
});

test("no heartbeat waits two cycles of a slow bot (queue 38: Scout, 600 s a cycle, stall_minutes 30); a fast bot keeps 10 min", () => {
  const scout = (beat: string) => word({ hb: hb(beat, "running", beat, { stall_minutes: 30 }) });
  assert.equal(scout("14:19").word, "working", "11 min after its last beat: between two normal beats");
  assert.equal(scout("14:09").word, "no heartbeat 21 min", "past two cycles");
  assert.equal(word({ hb: hb("14:19", "running", "14:19", { stall_minutes: 15 }) }).word, "no heartbeat 11 min", "a 20 s bot: 10 min as before");
  assert.equal(word({ hb: hb("14:19", "running", "14:19") }).word, "no heartbeat 11 min", "no stall_minutes: 10 min");
});

test("a read without a URL is on the page the bot last opened (queue 38): the card's screen names that site", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "board-read-"));
  const ws = path.join(dir, "lead-gen", "workspace");
  await mkdir(path.join(ws, "logs"), { recursive: true });
  await writeFile(path.join(ws, "logs", "explorer.jsonl"), ev("14:29", "action") + "\n");
  const db = path.join(ws, "explorer.sqlite3");
  execFileSync("/usr/bin/sqlite3", [db], {
    input: [
      "CREATE TABLE actions (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, episode_id INTEGER, action_type TEXT, payload TEXT, thought TEXT, verdict TEXT, result TEXT, progress INTEGER DEFAULT 0);",
      "CREATE TABLE heartbeat (id INTEGER PRIMARY KEY, ts TEXT, cycle INTEGER, status TEXT, current_url TEXT, current_question TEXT, last_action TEXT, last_progress_at TEXT, model_failures INTEGER DEFAULT 0, next_planned TEXT, pid INTEGER, stall_minutes REAL);",
      "CREATE TABLE questions (id INTEGER PRIMARY KEY, created_at TEXT, question TEXT, status TEXT DEFAULT 'open', answered_at TEXT, answer_note_id INTEGER, times_pursued INTEGER DEFAULT 0);",
      "CREATE TABLE interests (topic TEXT PRIMARY KEY, weight REAL, updated_at TEXT);",
      `INSERT INTO heartbeat(ts, cycle, status, last_progress_at, stall_minutes) VALUES ('${at("14:29")}', 1, 'running', '${at("14:29")}', 15);`,
      `INSERT INTO actions(ts, cycle, action_type, payload, verdict, result) VALUES ('${at("14:20")}', 1, 'open', '{"url":"https://www.florist.example/about"}', 'allowed', 'opened https://www.florist.example/about: ''About the florist'' (900 chars)');`,
      `INSERT INTO actions(ts, cycle, action_type, payload, verdict, result) VALUES ('${at("14:28")}', 1, 'read', '{"type":"read"}', 'allowed', 'read 4 000 chars');`,
    ].join("\n"),
  });
  const card = await boardBot({ slug: "lead-gen", name: "Lead Gen", handle: "leadA" }, ws, db, null, NOW);
  assert.deepEqual(card.last?.screen, { kind: "web", domain: "florist.example", title: "About the florist" });
});

test("a rest that outlives a restart (engine 158c746): rest-until.json says resting, whatever the log says", () => {
  // after a restart the log has rest_resumed (not a rest kind here) and the newest heartbeat is the restart's
  const rest = { until: "2026-10-30T14:50:00", why: "day_block_rest", reason: "three day-blocked actions this episode" };
  assert.deepEqual(word({ hb: hb("14:29"), rest, dayBlocks: 4, jsonl: [ev("14:20", "episode")] }), { word: "resting until 14:50", tone: "muted", why: "4 things blocked today" });
  assert.equal(word({ hb: hb("14:29"), rest: { until: "2026-10-30T14:40:00", why: "idle", reason: "the work list is empty, today's tasks done" } }).why, "work list empty");
  // a file past its end (left by a stop) does not hold the state
  assert.equal(word({ hb: hb("14:29"), rest: { ...rest, until: "2026-10-30T14:10:00" }, jsonl: [ev("14:29", "action")] }).word, "working");
});

test("floating screens (queue 39): only pages the owner would approve; one per address, the newest wins", () => {
  const deny = parseDenylist("# comment\ndomain:accounts.google.com\ndomain:blocked.example\npath:login\n");
  const row = (t: string, url: string, title: string, chars: number, v = "allowed", extra = "") => ({ t, p: JSON.stringify({ url }), v, r: `opened ${url}: '${title}' (${chars} chars, 9 links)${extra}` });
  assert.equal(validPage(row("open", "https://www.florist.example/about", "About us", 1200), deny), "https://www.florist.example/about");
  assert.equal(validPage(row("follow", "https://www.florist.example/menu", "Menu", 900), deny), "https://www.florist.example/menu");
  assert.equal(validPage(row("open", "https://a.example/", "A", 1200, "rejected: you have read this site enough today"), deny), null, "refused");
  assert.equal(validPage(row("open", "https://b.example/", "Just a moment...", 1200, "allowed", " Cloudflare"), deny), null, "captcha");
  assert.equal(validPage(row("open", "https://c.example/", "Tiny", 120), deny), null, "under 500 characters");
  assert.equal(validPage(row("open", "https://d.example/", "", 1200), deny), null, "no title");
  assert.equal(validPage(row("open", "https://login.shop.example/", "Sign in", 1200), deny), null, "a login host");
  assert.equal(validPage(row("open", "https://shop.example/account/signin", "Sign in", 1200), deny), null, "a sign-in path");
  assert.equal(validPage(row("open", "https://shop.example/login.html", "Log in", 1200), deny), null, "a denylisted path");
  assert.equal(validPage(row("open", "https://www.google.com/search?q=x", "x - Google Search", 5000), deny), null, "a search engine");
  assert.equal(validPage(row("open", "https://sub.blocked.example/page", "Page", 1200), deny), null, "a denylisted domain");
  assert.equal(validPage(row("read", "https://florist.example/", "About", 1200), deny), null, "a read is not an open");
  // across the family: newest first, one per address
  const recent = (rows: { ts: string; t: string; p: string; v: string; r: string }[]) => ({ recent: JSON.stringify(rows), today: "{}", latest: null });
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const page = (ts: string, url: string, title: string) => ({ ts, ...row("open", url, title, 1500) });
  const d = webData(
    [
      { slug: "lead-gen", name: "Lead Gen", row: recent([page("2026-10-31T11:50:00", "https://florist.example/", "Florist"), page("2026-10-31T11:40:00", "https://bakery.example/", "Bakery")]) },
      { slug: "scout", name: "Scout", row: recent([page("2026-10-31T11:55:00", "https://florist.example/", "Florist again")]) },
    ],
    now,
    deny,
  );
  assert.deepEqual(d.recent_pages.map((p: { name: string; url: string; title: string; ago: string; shot: string | null }) => [p.name, p.url, p.title, p.ago, p.shot]), [
    ["Scout", "https://florist.example/", "Florist again", "5 min ago", null],
    ["Lead Gen", "https://bakery.example/", "Bakery", "20 min ago", null],
  ]);
});

test("a refused web row says why in plain words (queue 44)", () => {
  const table: [string, string][] = [
    ["rejected: you have read this site enough today; write what you have or move on. It stays blocked until tomorrow.", "site read enough today; blocked until tomorrow"],
    ["rejected: you searched that today; the answer did not change. Open a result you have, or search for something different.", "same search as earlier today"],
    ["rejected: you already searched 'Movewell Physio New York' this episode. Do not search it again in other words: open one of its results (follow N), or search", "same search twice in one episode"],
    ["rejected: that was refused or done already today; it stays blocked until tomorrow. Do something different.", "refused or done earlier today; blocked until tomorrow"],
    ["rejected: that action is blocked for this episode (repeated too often, or refused earlier)", "blocked for this episode (repeated or refused before)"],
    ["rejected: open only an address you have actually seen -- on a page's link list this episode, or one you visited before. That URL", "address typed from memory, not from a link list"],
    ["rejected: move on: 5 pages on tti-cloud.com today and nothing written from it (no lead, update or note). This site", "5 pages on tti-cloud.com today, nothing written; move on"],
    ["rejected: you have opened or read 6 pages without noting anything; note what you learned", "6 pages read without a note"],
    ["rejected: www.google.com asks bots not to read that page (robots.txt)", "the site asks bots not to read it (robots.txt)"],
    ["rejected: episode budget used up; summarize now (one last note, ask or say is also fine)", "episode budget used up"],
    ["rejected: no page is open", "no page is open"],
  ];
  for (const [verdict, want] of table) assert.equal(refusalWords(verdict), want, verdict);
  // an unknown text: cut at a sentence end before ~110 characters, else at a word with an ellipsis
  const long = "rejected: the lead's website is a listing page, not its own site. Open the business's own site and check its contact page before you list it.";
  assert.equal(refusalWords(long), "the lead's website is a listing page, not its own site.");
  const run = `rejected: ${"word ".repeat(40)}`;
  const cut = refusalWords(run);
  assert.ok(cut.endsWith("word…") && cut.length <= 111, cut);
  assert.equal(webReason("captcha", "allowed"), "captcha or access wall");
  assert.equal(webReason("empty", "allowed"), "empty page");
  assert.equal(webReason("ok", "allowed"), "");
  assert.equal(webReason("refused", "rejected:"), "refused");
  // webData carries it
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const rows = [
    { ts: "2026-10-31T11:58:00", t: "search", p: JSON.stringify({ query: "florists" }), v: "rejected: you searched that today; the answer did not change.", r: null },
    { ts: "2026-10-31T11:57:00", t: "open", p: JSON.stringify({ url: "https://x.example/" }), v: "allowed", r: "opened https://x.example/: 'Just a moment' captcha" },
    { ts: "2026-10-31T11:56:00", t: "open", p: JSON.stringify({ url: "https://y.example/" }), v: "allowed", r: "opened https://y.example/: 'Home' (1500 chars)" },
  ];
  const d = webData([{ slug: "lead-gen", name: "Lead Gen", row: { recent: JSON.stringify(rows), today: "{}", latest: null } }], now);
  assert.deepEqual(d.events.map((e: { mark: string; reason: string }) => [e.mark, e.reason]), [
    ["refused", "same search as earlier today"],
    ["captcha", "captcha or access wall"],
    ["ok", ""],
  ]);
});

test("the family's messages: each bot's sent ones and the owner's lines, newest five, text cut to 60 (queue 46)", () => {
  const rows = [
    { id: 14724, ts: "2026-10-31T12:42:44", p: JSON.stringify({ type: "message", to: "The CEO", text: "Understood, CEO. I am prioritizing focused, direct research queries to maintain high quality." }) },
    { id: 14700, ts: "2026-10-31T11:00:00", p: '{"type": "message", "to": "everyone", "text": "A payload cut at four hundred char' },
  ];
  const sent = sentOf({ slug: "research-analyst", name: "Research Analyst" }, rows);
  assert.deepEqual(sent[0], { id: "research-analyst:14724", ts: "2026-10-31T12:42:44", from: "Research Analyst", to: "The CEO", text60: "Understood, CEO. I am prioritizing focused, direct research…", text120: "Understood, CEO. I am prioritizing focused, direct research queries to maintain high quality." });
  assert.equal(sent[1].to, "everyone");
  assert.equal(sent[1].text60, "A payload cut at four hundred char");
  const owner = [{ slug: "scout", name: "Scout", ts: "2026-10-31T13:00:00", text: "Look at free maps" }];
  const more = Array.from({ length: 4 }, (_, i) => ({ id: `lead-gen:${i}`, ts: `2026-10-31T0${i}:00:00`, from: "Lead Gen", to: "Validator", text60: "x", text120: "x" }));
  const all = familyMessages([...sent, ...more], owner);
  assert.equal(all.length, 5);
  assert.deepEqual(all.map((m) => m.id).slice(0, 3), ["owner:scout:2026-10-31T13:00:00", "research-analyst:14724", "research-analyst:14700"]);
  assert.deepEqual({ from: all[0].from, to: all[0].to }, { from: "Owner", to: "Scout" });
});

test("state: one or two failed calls keep a bot working, retrying; three in a row or the outage rule turn it red (queue 49)", () => {
  const one = word({ hb: hb("14:29", "model_failure", "14:29", { model_failures: 1 }), jsonl: [ev("14:29", "action")] });
  assert.deepEqual(one, { word: "working", tone: "good", why: "1 failed call, retrying" });
  assert.equal(word({ hb: hb("14:29", "model_failure", "14:29", { model_failures: 2 }), jsonl: [ev("14:29", "action")] }).why, "2 failed calls, retrying");
  const three = word({ hb: hb("14:29", "model_failure", "14:29", { model_failures: 3 }), jsonl: [ev("14:29", "action")] });
  assert.deepEqual(three, { word: "blocked on the model provider", tone: "warn", why: "3 failed calls in a row" });
  // the provider is out (first_fail set): any failed call in a row is red; no failure, or not working, stays as it is
  const card = { state: one, failing: 1 };
  assert.equal(withOutage(card, false), card);
  assert.equal(withOutage(card, true).state.word, "blocked on the model provider");
  assert.equal(withOutage({ state: { word: "working", tone: "good" as const, why: "" }, failing: 0 }, true).state.word, "working");
  assert.equal(withOutage({ state: { word: "resting until 15:00", tone: "muted" as const, why: "" }, failing: 1 }, true).state.word, "resting until 15:00");
});

test("the model line: provider and time from the newest trace, none without traces (queue 49)", async () => {
  const ws = await mkdtemp(path.join(tmpdir(), "ws-"));
  assert.equal(await lastModel(ws), null);
  const day = path.join(ws, "traces", "2026-10-31");
  await mkdir(day, { recursive: true });
  await writeFile(path.join(day, "104700-1-open.json"), JSON.stringify({ at: "2026-10-31T10:47:00", model: "api.groq.com/old", reply: "" }));
  await writeFile(path.join(day, "140512-9-update_lead.json"), JSON.stringify({ at: "2026-10-31T14:05:12", model: "api.z.ai/glm-4.5-flash", reply: "" }));
  await writeFile(path.join(day, "140600-10-open.json"), "{ torn");
  assert.deepEqual(await lastModel(ws), { label: "api.z.ai/glm-4.5-flash", ts: "2026-10-31T14:05:12" });
});

test("a STOP file's reason: its first non-empty line, trimmed, cut at 160; an owner's empty STOP has none", () => {
  assert.equal(stopReason(""), "");
  assert.equal(stopReason(null), "");
  assert.equal(stopReason("\n  migration: tasks move, creatorCC, back in ~20 min  \nmore\n"), "migration: tasks move, creatorCC, back in ~20 min");
  assert.equal(stopReason("x".repeat(200)).length, 160);
});

test("a member's item on its world screen comes from the write that names it (creatorCC queue 233)", () => {
  const lead = JSON.stringify({ type: "update_lead", name: "Fiesta Lounge", draft_email: "Hi…", pain_point: null, email: "", sources: ["https://x.example"] });
  assert.equal(subjectOf("update_lead", lead), "Fiesta Lounge · Draft email");
  assert.equal(subjectOf("update_lead", JSON.stringify({ name: "Corner Cafe", location: "Astoria", size: "3 locations", industry: "Cafe" })), "Corner Cafe · Location, Industry");
  assert.equal(subjectOf("provider", JSON.stringify({ name: "Gonka Broker" })), "Gonka Broker");
  assert.equal(subjectOf("message", JSON.stringify({ to: "The CEO", text: "Handing over the Starter Website package." })), "to The CEO: Handing over the Starter Website package.");
  assert.equal(subjectOf("update_lead", "not json"), "");
});

test("activity lines (queue 287): plain words, the page's kind, a lead's name and cell, never an email or a phone", async () => {
  // @ts-ignore TS5097
  const { activityLine } = await import("../lib/board.ts");
  assert.deepEqual(activityLine("open", JSON.stringify({ url: "https://www.cibao-restaurant.com/menu" }), "2026-11-06T15:31:02"), { ts: "2026-11-06T15:31:02", hhmm: "15:31", words: "opened cibao-restaurant.com · menu page", kind: "web" });
  assert.equal(activityLine("open", JSON.stringify({ url: "https://cibao.example/" }), "2026-11-06T15:31:02").words, "opened cibao.example · home page");
  assert.equal(activityLine("search", JSON.stringify({ query: "Cibao Restaurant Bronx" }), "2026-11-06T15:30:00").words, "searched 'Cibao Restaurant Bronx'");
  assert.equal(activityLine("update_lead", JSON.stringify({ name: "Fiesta Lounge", phone: "+1 718 555 0100" }), "2026-11-06T15:28:00").words, "updated Fiesta Lounge · Phone");
  assert.equal(activityLine("message", JSON.stringify({ to: "The CEO", text: "hi" }), "2026-11-06T15:25:00").words, "messaged The CEO");
  const s = activityLine("search", JSON.stringify({ query: "owner@fiesta.example +1 718 555 0100 Bronx" }), "2026-11-06T15:20:00").words;
  assert.ok(!/@|555/.test(s), s);
});
