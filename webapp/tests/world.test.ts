// Run: npm test. The office world's pure parts on a fixture board (2026-10-30): what each state
// looks like, the dialogue box, the speech bubble a new action brings, the walks between spots and each member's look.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { animOf, bedSpot, BUBBLE_MS, desk, dialogue, downtimeLine, lookOf, monitorOf, newBubbles, restUntil, route, sofaSeat, stormOf, TERMINAL, week7Lines, LOUNGE } from "../lib/world.ts";
// @ts-ignore TS5097
import { screenOf } from "../lib/board.ts";

const card = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: "Lead Gen",
  handle: "leaA",
  state: { word: "working", tone: "good", why: "" },
  on: "Process NYC business candidates · step 2 of 3: Open new candidate sites",
  onKind: "plan",
  last: { ts: "2026-10-30T14:20:00", words: "listed lead 'Bloom'", ago: "3 min ago" },
  output: { label: "lead", today: 12 },
  refusedShare: 0.25,
  actionsToday: 80,
  hours: [],
  questions: ["Which shops publish an email?"],
  interests: ["bakeries", "nyc florists"],
  model: { label: "api.z.ai/glm-4.5-flash", ts: "2026-10-30T14:21:30" },
  feed: [],
  ...extra,
});

test("state to animation", () => {
  assert.equal(animOf({ word: "working" }), "working");
  assert.equal(animOf({ word: "resting until 14:40" }), "resting");
  assert.equal(animOf({ word: "quiet" }), "quiet");
  assert.equal(animOf({ word: "blocked on The CEO's hold" }), "blocked");
  assert.equal(animOf({ word: "blocked on the model provider" }), "blocked");
  assert.equal(animOf({ word: "stalled" }), "lost");
  assert.equal(animOf({ word: "no heartbeat 25 min" }), "lost");
  assert.equal(animOf({ word: "paused" }), "idle");
  assert.equal(animOf({ word: "waiting for a task" }), "idle");
  assert.equal(stormOf({ word: "blocked on the model provider" }), true);
  assert.equal(stormOf({ word: "blocked on The CEO's hold" }), false);
  assert.equal(restUntil({ word: "resting until 14:40" }), "14:40");
});

test("dialogue: state, working on, questions and interests before the last action, output, the model used", () => {
  const d = dialogue(card("lead-gen", { state: { word: "resting until 14:40", tone: "muted", why: "work list empty" } }) as never);
  assert.equal(d.title, "Lead Gen leaA");
  assert.deepEqual(d.lines, [
    "Resting until 14:40 · work list empty",
    "Working on: Process NYC business candidates, step 2 of 3: Open new candidate sites",
    "Asking: Which shops publish an email?",
    "Interested in: bakeries, nyc florists",
    "Last: listed lead 'Bloom', 3 min ago",
    "12 leads today · refused 25%",
    "Model: api.z.ai/glm-4.5-flash (last call 14:21)",
  ]);
  const bare = dialogue(card("x", { on: "", last: null, output: null, refusedShare: null, questions: [], interests: [], model: null }) as never);
  assert.deepEqual(bare.lines, ["Working", "Last: no accepted action yet", "80 actions today"]);
  const thinking = dialogue(card("x", { on: "I should open the contact page", onKind: "thought" }) as never);
  assert.equal(thinking.lines[1], "Thinking: I should open the contact page");
});

test("speech bubble: only for a newer accepted action, for about 5 s, none on the first poll", () => {
  const before = [card("a"), card("b")];
  const after = [card("a", { last: { ts: "2026-10-30T14:25:00", words: "opened salon.example", ago: "5 s ago" } }), card("b")];
  assert.deepEqual(newBubbles(null, after as never, 1000), []);
  assert.deepEqual(newBubbles(before as never, after as never, 1000), [{ slug: "a", text: "opened salon.example", until: 1000 + BUBBLE_MS }]);
  assert.deepEqual(newBubbles(after as never, after as never, 2000), []);
});

test("walks: along the aisles and the corridor, ending on the spot, never through a desk row", () => {
  const seat = desk(1).seat;
  const go = route(seat, TERMINAL);
  assert.deepEqual(go[go.length - 1], TERMINAL);
  assert.ok(go.every((p: { x: number; y: number }) => p.y !== 4 && p.y !== 8), "no stop on a desk row");
  const back = route(TERMINAL, seat);
  assert.deepEqual(back[back.length - 1], seat);
  const sofa = route(desk(5).seat, sofaSeat(0));
  assert.deepEqual(sofa[sofa.length - 1], sofaSeat(0));
  assert.deepEqual(route(seat, seat), []);
  // the terminal by the left wall: reached along the free aisle (row 5), from either desk row
  const fromBack = route(desk(5).seat, TERMINAL);
  assert.deepEqual(fromBack[fromBack.length - 1], TERMINAL);
  assert.ok(fromBack.every((p: { x: number; y: number }) => p.y !== 6 && p.y !== 4 && p.y !== 8), "no walk along a monitor or desk row");
});

test("looks: each family member distinct, the same every time", () => {
  const slugs = ["the-ceo", "lead-gen", "lead-enricher", "outreach-writer", "package-designer", "research-analyst", "desk-agent", "jobless-bot", "onion-reader", "scout"];
  const looks = slugs.map((s) => lookOf(s));
  assert.equal(new Set(looks.map((l: { shirt: string }) => l.shirt)).size, slugs.length);
  assert.deepEqual(lookOf("lead-gen"), lookOf("lead-gen"));
  assert.equal(lookOf("the-ceo").accessory, "crown");
  assert.ok(lookOf("someone-new").shirt);
});

test("7 days tab: actions and refused share, outputs by type, crashes, last output", () => {
  const w = { actions: 900, refused: 270, refusedShare: 0.3, outputs: { note: 4, lead: 61 }, crashes: 2, lastCrash: "10-29 03:12 TimeoutError", lastOutput: { label: "lead", ago: "3 h ago", late: false } };
  assert.deepEqual(week7Lines(w), ["900 actions · 270 refused (30%)", "Accepted: 61 leads, 4 notes", "Crashes: 2 (last 10-29 03:12 TimeoutError)", "Last lead: 3 h ago"]);
  assert.deepEqual(week7Lines({ ...w, outputs: {}, crashes: 0, lastOutput: { label: "draft", ago: "2 d ago", late: true } }).slice(1), ["Accepted: nothing yet", "Crashes: none", "Last draft: 2 d ago (overdue)"]);
  assert.deepEqual(week7Lines(undefined), ["The 7-day numbers are still being read."]);
});

test("downtime line for the last 24 h", () => {
  assert.equal(downtimeLine(null), "");
  assert.equal(downtimeLine({ off: [], quiet: [], offMin: 0, quietMin: 0 }), "Last 24 h: the Mac was on and nobody was quiet.");
  assert.equal(
    downtimeLine({ off: [{ note: "no clean shutdown logged" }], quiet: [{ note: "Steam is in front" }, { note: "Steam is in front (still quiet)" }], offMin: 541, quietMin: 40 }),
    "Last 24 h: Mac off 9 h 1 min (no clean shutdown) · quiet 40 min (Steam is in front).",
  );
});

test("monitor: what the screen shows for open, search, update_lead and note, from fixture actions", () => {
  const open = screenOf("open", JSON.stringify({ url: "https://www.salon.example" }), "opened https://www.salon.example: 'Salon | Springfield' (1155 chars, 11 links)", null);
  assert.deepEqual(open, { kind: "web", domain: "salon.example", title: "Salon | Springfield" });
  assert.equal(screenOf("open", "{}", "opened https://events.example: 'Party events &amp;amp;amp; parties' (9 chars)", null).title, "Party events & parties");
  const follow = screenOf("follow", JSON.stringify({ link: 5 }), "followed [5] to https://studio.example/portfolio/cafe/: 'Cafe - Restaurant Design' -- not a business's own site", null);
  assert.deepEqual(follow, { kind: "web", domain: "studio.example", title: "Cafe - Restaurant Design" });
  assert.deepEqual(screenOf("read", '{"type":"read"}', "read 4 000 chars", "https://www.bakery.example/menu"), { kind: "web", domain: "bakery.example", title: "" });
  const search = screenOf("search", JSON.stringify({ query: "nyc florists" }), "searched 'nyc florists': ...", null);
  assert.deepEqual(search, { kind: "search", domain: "", title: "nyc florists" });
  assert.deepEqual(screenOf("update_lead", JSON.stringify({ name: "Wagging Tails", draft_email: "Hi" }), "", null), { kind: "doc", domain: "", title: "Wagging Tails" });
  assert.deepEqual(screenOf("note", JSON.stringify({ title: "Pricing in Brooklyn" }), "", null), { kind: "doc", domain: "", title: "Pricing in Brooklyn" });

  const at = (screen: unknown, words = "opened salon.example", word = "working") => ({ state: { word }, last: { ts: "x", words, ago: "", screen } });
  assert.deepEqual(monitorOf(at(open) as never), { mode: "web", bar: "salon.example", lines: ["Salon | Springfield"] });
  assert.deepEqual(monitorOf(at(open) as never, { compact: true }), { mode: "web", bar: "salon.example", lines: [] });
  assert.deepEqual(monitorOf(at(search, "searched 'nyc florists'") as never), { mode: "search", bar: "search", lines: ["nyc florists"] });
  assert.deepEqual(monitorOf(at({ kind: "doc", domain: "", title: "Pricing in Brooklyn" }, "wrote note 'Pricing in Brooklyn'") as never), { mode: "doc", bar: "wrote", lines: ["Pricing in Brooklyn"] });
});

test("monitor: dark with the clock while resting or quiet, red page when blocked, static on a model failure, dim when silent", () => {
  const last = { ts: "x", words: "opened a.com", ago: "", screen: { kind: "web", domain: "a.com", title: "A" } };
  assert.deepEqual(monitorOf({ state: { word: "resting until 14:40" }, last } as never), { mode: "dark", bar: "14:40", lines: [] });
  assert.equal(monitorOf({ state: { word: "quiet" }, last } as never).mode, "dark");
  assert.equal(monitorOf({ state: { word: "blocked on The CEO's hold" }, last } as never).mode, "alert");
  assert.equal(monitorOf({ state: { word: "blocked on the model provider" }, last } as never, { noise: true }).mode, "static");
  assert.equal(monitorOf({ state: { word: "no heartbeat 25 min" }, last } as never).mode, "dim");
  assert.equal(monitorOf({ state: { word: "working" }, last: null } as never).mode, "dim");
});

test("day and night by the Mac's clock: sky, darkness, lamps after 18:00", async () => {
  // @ts-ignore TS5097
  const { dayPhase } = await import("../lib/world.ts");
  assert.equal(dayPhase(12).phase, "day");
  assert.equal(dayPhase(12).dark, 0);
  assert.equal(dayPhase(12).lamps, false);
  assert.equal(dayPhase(6, 30).phase, "dawn");
  assert.equal(dayPhase(17, 30).phase, "dusk");
  assert.equal(dayPhase(17, 59).lamps, false);
  assert.equal(dayPhase(18).lamps, true);
  assert.equal(dayPhase(23).phase, "night");
  assert.equal(dayPhase(3).lamps, true);
  assert.ok(dayPhase(23).dark > dayPhase(18, 30).dark);
  assert.equal(dayPhase(7).lamps, false);
});

test("bulletin prompts: proposals one at a time with Yes / No, then each decision with its options, then nothing", async () => {
  // @ts-ignore TS5097
  const { answerBody, nextPrompt } = await import("../lib/world.ts");
  const b = {
    proposals: [
      { id: "p1", bot: "Lead Gen", change: "Add rule: Skip chains", reason: "chains never reply", metric: "leads listed", expected: "fewer, better", validator: "fits KR1" },
      { id: "p2", bot: "The CEO", change: "New goal: Weekly OKR", reason: "", metric: "", expected: "", validator: "" },
    ],
    decisions: [
      { id: "d1", since: "2026-10-29", text: "Take free.ai out?", options: ["Take it out", "Keep it"], link: { label: "Providers", href: "/settings/providers" } },
      { id: "d2", since: "2026-10-30", text: "Mac set to never sleep?", options: [], link: null },
    ],
  };
  const first = nextPrompt(b, new Set());
  assert.equal(first.kind, "proposal");
  assert.equal(first.id, "p1");
  assert.deepEqual(first.lines, ["Add rule: Skip chains", "Why: chains never reply", "Measure: leads listed, expected fewer, better", "Validator: fits KR1", "Approve it?"]);
  assert.deepEqual(answerBody("p1", true, "  try a week "), { id: "p1", action: "approve", note: "try a week" });
  assert.deepEqual(answerBody("p2", false, ""), { id: "p2", action: "decline", note: "" });
  assert.equal(nextPrompt(b, new Set(["p1"])).id, "p2");
  const dec = nextPrompt(b, new Set(["p1", "p2"]));
  assert.equal(dec.kind, "decision");
  assert.equal(dec.title, "Decision waiting for you (1 of 2) · since 10-29");
  assert.deepEqual(dec.lines, ["Take free.ai out?"]);
  assert.ok(dec.kind === "decision" && dec.options.join() === "Take it out,Keep it" && dec.link?.href === "/settings/providers");
  assert.equal(nextPrompt(b, new Set(["p1", "p2", "d1"])).title, "Decision waiting for you · since 10-30");
  assert.equal(nextPrompt(b, new Set(["p1", "p2", "d1", "d2"])).kind, "done");
  assert.equal(nextPrompt({ proposals: [], decisions: [] }, new Set()).kind, "done");
});

test("idle moves: a working member stretches, sips or glances now and then, never frozen for long", async () => {
  // @ts-ignore TS5097
  const { idleOf } = await import("../lib/world.ts");
  const seen = new Set<string | null>();
  for (let t = 0; t < 200_000; t += 200) seen.add(idleOf("lead-gen", t));
  assert.ok(seen.has(null) && seen.has("stretch") && seen.has("sip") && seen.has("glance"));
  let gap = 0;
  let longest = 0;
  for (let t = 0; t < 60_000; t += 100) {
    gap = idleOf("the-ceo", t) ? 0 : gap + 100;
    longest = Math.max(longest, gap);
  }
  assert.ok(longest <= 14_000, `longest still spell ${longest} ms`);
});

test("member panel: a member opens Info, a desk opens Screen, the next member keeps the tab, close collapses, the strip expands", async () => {
  // @ts-ignore TS5097
  const { panelNext } = await import("../lib/world.ts");
  type P = { open: boolean; tab: "info" | "screen" | "feed" };
  let p: P = { open: false, tab: "info" };
  p = panelNext(p, "member");
  assert.deepEqual(p, { open: true, tab: "info" });
  p = panelNext(p, "desk");
  assert.deepEqual(p, { open: true, tab: "screen" });
  p = panelNext({ ...p, tab: "feed" }, "next");
  assert.deepEqual(p, { open: true, tab: "feed" }, "arrows keep the tab");
  p = panelNext(p, "close");
  assert.deepEqual(p, { open: false, tab: "feed" });
  p = panelNext(p, "expand");
  assert.deepEqual(p, { open: true, tab: "feed" });
  assert.deepEqual(panelNext(p, "member"), { open: true, tab: "info" });
});

test("sleeping corner grows: four mats, three more to their left clear of the sofa, then a second row; no two on one spot", () => {
  const spots = Array.from({ length: 12 }, (_, i) => bedSpot(i));
  // the lounge sits LOUNGE rows lower since the desks got their big screens
  const y = 11.5 + LOUNGE;
  assert.deepEqual(spots.slice(0, 4), [{ x: 16, y }, { x: 18, y }, { x: 20, y }, { x: 22, y }]);
  assert.deepEqual(spots.slice(4, 7), [{ x: 14, y }, { x: 12, y }, { x: 10, y }]);
  assert.ok(spots.slice(0, 7).every((p) => p.x * 16 - 13 >= 104), "clear of the sofa (ends at 104 px)");
  assert.ok(spots[7].y < y, "the eighth starts a second row");
  assert.equal(new Set(spots.map((p) => `${p.x},${p.y}`)).size, 12);
});

test("a desk for every family member: ten desks, none overlapping", () => {
  const all = Array.from({ length: 10 }, (_, i) => desk(i).desk);
  assert.equal(new Set(all.map((d) => `${d.x},${d.y}`)).size, 10);
  assert.ok(all.every((d) => d.x * 16 + 44 <= 21 * 16), "every desk left of the terminal's aisle");
});

test("restarting: the bot stays at its desk, not in the sleeping corner", () => {
  assert.equal(animOf({ word: "restarting" }), "idle");
});

// Made for video: the director, the ticker, the recording, the time-lapse and the strip they sit in
test("director: whoever acted gets the inset for 3 s, then the next; nobody acting pans; gone members are skipped", async () => {
  // @ts-ignore TS5097
  const { newDirector, directorStep, insetSource, panAt, DIRECTOR_HOLD_MS, COLS, ROWS, TILE } = await import("../lib/world.ts");
  const all = ["lead-gen", "scout", "the-ceo"];
  let d = directorStep(newDirector(), 0, [], all);
  assert.equal(d.focus, null, "idle: the pan");
  d = directorStep(d, 1000, ["scout", "the-ceo"], all);
  assert.equal(d.focus, "scout");
  d = directorStep(d, 1000 + DIRECTOR_HOLD_MS - 1, ["lead-gen"], all);
  assert.equal(d.focus, "scout", "held for 3 s");
  d = directorStep(d, 1000 + DIRECTOR_HOLD_MS, [], all);
  assert.equal(d.focus, "the-ceo", "then the next who acted");
  d = directorStep(d, 1000 + 2 * DIRECTOR_HOLD_MS, [], ["lead-gen", "the-ceo"]);
  assert.equal(d.focus, "lead-gen");
  d = directorStep(d, 1000 + 3 * DIRECTOR_HOLD_MS, [], all);
  assert.equal(d.focus, null, "nobody left: back to the pan");
  // a member that left the room is skipped
  assert.equal(directorStep(newDirector(), 0, ["validator", "scout"], all).focus, "scout");
  // the inset: a sixth of the room (shown at 2x), on the head, inside the room; the pan sweeps and comes back
  const W = COLS * TILE;
  const H = ROWS * TILE;
  const r = insetSource({ x: 200, y: 150 }, 0);
  assert.deepEqual([r.w, r.h], [W / 6, H / 6]);
  assert.ok(r.x + r.w / 2 === 200 && Math.abs(r.y + r.h / 2 - 140) < 1e-9);
  const edge = insetSource({ x: 2, y: H - 4 }, 0);
  assert.ok(edge.x === 0 && Math.abs(edge.y + edge.h - H) < 1e-9, "clamped");
  const pan = insetSource(null, 30_000);
  assert.ok(Math.abs(pan.x + pan.w - W) < 1e-9 && pan.y >= 0 && pan.y + pan.h <= H, "the pan reaches the far side inside the room");
  assert.ok(panAt(0) === 0 && Math.abs(panAt(30_000) - 1) < 1e-9 && Math.abs(panAt(60_000)) < 1e-9);
});

test("ticker: live numbers from the board's cards, the scroll pauses under the pointer", async () => {
  // @ts-ignore TS5097
  const { tickerText, tickerScroll, TICKER_SPEED } = await import("../lib/world.ts");
  const cards = [
    { output: { label: "lead", today: 35 }, refusedShare: 0.2, actionsToday: 100 },
    { output: { label: "draft", today: 14 }, refusedShare: 0.5, actionsToday: 40 },
    { output: { label: "note", today: 57 }, refusedShare: 0, actionsToday: 60 },
    { output: null, refusedShare: null, actionsToday: 0 },
  ];
  assert.equal(tickerText(cards), "Leads today 35   ·   Drafts today 14   ·   Refused 20% of actions");
  assert.equal(tickerText([]), "Leads today 0   ·   Drafts today 0   ·   Refused 0% of actions");
  assert.match(tickerText([{ output: null, refusedShare: 0.31, actionsToday: 100 }]), /Refused 31% of actions/);
  assert.equal(tickerScroll(10, 1, false, 500), 10 + TICKER_SPEED);
  assert.equal(tickerScroll(10, 1, true, 500), 10, "paused on hover");
  assert.equal(tickerScroll(495, 1, false, 500), (495 + TICKER_SPEED) % 500, "wraps");
});

test("record 60 s: start, stop at 60 s, the Chrome note where WebM recording is missing; the 10x time-lapse", async () => {
  // @ts-ignore TS5097
  const { recStart, recTick, REC_MS, lapseHour } = await import("../lib/world.ts");
  const idle = { state: "idle" as const, until: 0 };
  const on = recStart(idle, 1000, true);
  assert.deepEqual(on, { state: "recording", until: 1000 + REC_MS });
  assert.equal(recStart(on, 5000, true), on, "a second click changes nothing");
  assert.deepEqual(recTick(on, 1000 + REC_MS - 1), { rec: on, stop: false });
  assert.deepEqual(recTick(on, 1000 + REC_MS), { rec: idle, stop: true }, "stops itself at 60 s");
  const note = recStart(idle, 0, false);
  assert.equal(note.state, "unsupported");
  assert.deepEqual(recTick(note, 6000), { rec: idle, stop: false }, "the note goes; nothing to stop");
  assert.equal(lapseHour(14, 0, 3_600_000), 0, "an hour of watching is ten hours of sky");
  assert.equal(lapseHour(14, 0, 360_000), 15);
});

test("the video strip covers nothing: the inset, caption and ticker sit under the room, the ticker under the inset", async () => {
  // @ts-ignore TS5097
  const { videoLayout, insetSource, COLS, ROWS, TILE } = await import("../lib/world.ts");
  const W = COLS * TILE;
  const H = ROWS * TILE;
  assert.deepEqual(videoLayout({ director: false, ticker: false }), { height: H, inset: null, caption: null, ticker: null }, "all off: the room as before");
  for (const v of [{ director: true, ticker: false }, { director: false, ticker: true }, { director: true, ticker: true }]) {
    const L = videoLayout(v);
    assert.ok(L.height > H && Number.isInteger(L.height));
    for (const box of [L.inset, L.caption, L.ticker]) {
      if (!box) continue;
      assert.ok(box.y >= H, `${JSON.stringify(box)} starts under the room`);
      assert.ok(box.x >= 0 && box.x + box.w <= W && box.y + box.h <= L.height, `${JSON.stringify(box)} inside the canvas`);
    }
    if (L.inset && L.caption) assert.ok(L.caption.x >= L.inset.x + L.inset.w, "the caption beside the inset");
    if (L.inset) {
      const src = insetSource(null, 0);
      assert.equal(L.inset.w, 2 * src.w, "2x across");
      assert.ok(Math.abs(L.inset.h - 2 * src.h) < 1, "2x down, to a whole pixel");
    }
    if (L.inset && L.ticker) assert.ok(L.ticker.y >= L.inset.y + L.inset.h, "the ticker under the inset");
    if (L.ticker) assert.equal(L.ticker.w, W, "the ticker along the whole width");
  }
});
