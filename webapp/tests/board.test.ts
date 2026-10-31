// Run: npm test. The home board's state words, words for actions, the plan line and the feed, on fixtures
// (2026-10-30).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-ignore TS5097
import { actionWords, ago, boardBot, hourly, mergeFeed, nowOn, parseEvents, stateOf, type Hb } from "../lib/board.ts";

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
  assert.equal(actionWords("open", JSON.stringify({ url: "https://www.salon.example/contact" })), "opened salon.example");
  assert.equal(actionWords("lead", JSON.stringify({ name: "Lina" })), "listed lead 'Lina'");
  assert.equal(actionWords("update_lead", JSON.stringify({ name: "Wagging Tails", draft_email: "Hi" })), "drafted an email for 'Wagging Tails'");
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
    [at("09:00"), "lead", '{"name":"Lina"}', "allowed"],
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
  assert.deepEqual(a.model, { label: "gemini/gemini-flash-lite-latest", ts: at("14:20") });
  const feed = mergeFeed([a, b]);
  assert.deepEqual(
    feed.map((f: { name: string; ts: string; words: string }) => `${f.ts.slice(11, 16)} ${f.name}: ${f.words}`),
    ["14:20 Lead Gen: listed lead 'Bloom'", "12:00 Research Analyst: wrote note 'Pricing'", "09:00 Lead Gen: listed lead 'Lina'"],
  );
  assert.equal(mergeFeed([a, b], 1).length, 1);
});
