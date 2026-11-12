// Run: npm test. The office world's pure parts on a fixture board (creatorCC queue 17, 2026-10-30): what each state
// looks like, the dialogue box, the speech bubble a new action brings, the walks between spots and each member's look.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { screenForm, animOf, bedSpot, dialogue, downtimeLine, lookOf, screenFor, slot, layout, SCREEN, wallOf, gridDistance, TERMINAL_BOX, BULLETIN, MAILBOX, MAX_DESKS, TILE, COLS, ROWS, restUntil, route, shoreSeat, stormOf, TERMINAL, week7Lines, webNote, obstacles, freeAt, placeDrawn, figureKey, screenKey, wallKey, NOTICE_SPOT, POST_SPOT, SIGNBOARD } from "../lib/world.ts";
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
  assert.equal(d.title, "Lead Gen leaA · binoculars");
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
  // the world's dialogue (queue 221): the state and the counts sit in its Now block, not in the list
  assert.deepEqual(dialogue(card("x", { on: "", last: null, output: null, refusedShare: null, questions: [], interests: [], model: null }) as never, { now: true }).lines, ["Last: no accepted action yet"]);
  const thinking = dialogue(card("x", { on: "I should open the contact page", onKind: "thought" }) as never);
  assert.equal(thinking.lines[1], "Thinking: I should open the contact page");
});

test("walks (queue 37): along the shore and the terrace paths, ending on the spot; every place reachable from every slot", () => {
  const spot = slot(1).spot;
  const go = route(spot, TERMINAL);
  assert.deepEqual(go[go.length - 1], TERMINAL);
  const back = route(TERMINAL, spot);
  assert.deepEqual(back[back.length - 1], spot);
  assert.deepEqual(route(spot, spot), []);
  const places = [TERMINAL, ...Array.from({ length: 5 }, (_, i) => shoreSeat(i)), ...Array.from({ length: MAX_DESKS }, (_, i) => slot(i).spot)];
  const beds = Array.from({ length: 10 }, (_, i) => bedSpot(i));
  for (let i = 0; i < MAX_DESKS; i++) {
    for (const p of places) assert.ok(Number.isFinite(gridDistance(slot(i).spot, p)), `slot ${i} cannot reach ${JSON.stringify(p)}`);
    for (const b of beds) assert.ok(Number.isFinite(gridDistance(slot(i).spot, b, beds)), `slot ${i} cannot reach the mat at ${JSON.stringify(b)}`);
  }
  // no walk crosses a low wall: a walk from the shore to the back row's spot goes round
  const down = route(shoreSeat(0), slot(5).spot);
  let at = shoreSeat(0);
  for (const q of down) {
    for (let k = 0; k <= 20; k++) {
      const x = at.x + ((q.x - at.x) * k) / 20;
      const y = at.y + ((q.y - at.y) * k) / 20;
      for (let i = 0; i < MAX_DESKS; i++) {
        const w = wallOf(i);
        assert.ok(!(x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1), `walks through slot ${i}'s wall at ${x},${y}`);
      }
    }
    at = q;
  }
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

test("downtime line: each span dated, past tense once over, present only while a quiet is open (queue 49)", () => {
  const now = new Date(2026, 9, 31, 14, 5, 0).getTime();
  assert.equal(downtimeLine(null, now), "");
  assert.equal(downtimeLine({ off: [], quiet: [] }, now), "Last 24 h: the Mac was on and nobody was quiet.");
  const yesterday = { from: "2026-10-30T15:20:10", to: "2026-10-30T22:12:00", minutes: 412, note: "steam_osx is running" };
  // every bot logged the same quiet: one span
  assert.equal(downtimeLine({ off: [], quiet: [yesterday, { ...yesterday }] }, now), "Last 24 h: Yesterday 15:20-22:12 quiet while Steam ran (6 h 52 min).");
  assert.equal(
    downtimeLine({ off: [{ from: "2026-10-31T01:02:00", to: "2026-10-31T07:30:00", minutes: 388, note: "no clean shutdown logged" }], quiet: [{ from: "2026-10-31T13:40:00", to: "2026-10-31T14:05:00", minutes: 25, note: "Steam is in front (still quiet)" }] }, now),
    "Last 24 h: Mac off Today 01:02-07:30 (6 h 28 min) (no clean shutdown) · quiet since 13:40 while Steam is in front (25 min so far).",
  );
  assert.equal(downtimeLine({ off: [], quiet: [{ from: "2026-10-31T09:00:00", to: "2026-10-31T09:30:00", minutes: 30, note: "the owner asked" }] }, now), "Last 24 h: Today 09:00-09:30 quiet (the owner asked) (30 min).");
});

test("screen (queue 37): what the big screen shows for a page, a search, a document and resting, from fixture actions", () => {
  const open = screenOf("open", JSON.stringify({ url: "https://www.tarynbrows.com" }), "opened https://www.tarynbrows.com: 'Taryn Brows | Brooklyn' (1155 chars, 11 links)", null);
  assert.deepEqual(open, { kind: "web", domain: "tarynbrows.com", title: "Taryn Brows | Brooklyn" });
  assert.equal(screenOf("open", "{}", "opened https://eventpros.example: 'Ward events &amp;amp;amp; parties' (9 chars)", null).title, "Ward events & parties");
  const follow = screenOf("follow", JSON.stringify({ link: 5 }), "followed [5] to https://nwdb.nyc/portfolio/catch-la/: 'Catch LA - Restaurant Design' -- not a business's own site", null);
  assert.deepEqual(follow, { kind: "web", domain: "nwdb.nyc", title: "Catch LA - Restaurant Design" });
  assert.deepEqual(screenOf("read", '{"type":"read"}', "read 4 000 chars", "https://www.bakery.example/menu"), { kind: "web", domain: "bakery.example", title: "" });
  const search = screenOf("search", JSON.stringify({ query: "nyc florists" }), "searched 'nyc florists': ...", null);
  assert.deepEqual(search, { kind: "search", domain: "", title: "nyc florists" });
  assert.deepEqual(screenOf("update_lead", JSON.stringify({ name: "Happy Paws", draft_email: "Hi" }), "", null), { kind: "doc", domain: "", title: "Happy Paws" });
  assert.deepEqual(screenOf("note", JSON.stringify({ title: "Pricing in Brooklyn" }), "", null), { kind: "doc", domain: "", title: "Pricing in Brooklyn" });

  const card = (screen: unknown, words = "opened tarynbrows.com", word = "working", why = "") => ({
    name: "Lead Gen",
    state: { word, tone: word === "working" ? "good" : "muted", why },
    last: { ts: "x", words, ago: "", screen },
    output: { label: "lead", today: 3 },
    actionsToday: 40,
    refusedShare: 0.25,
  });
  // the four kinds of screen: a page, a search, a document, resting
  assert.deepEqual(screenFor(card(open) as never), { mode: "web", name: "Lead Gen", word: "working", tone: "good", lines: ["tarynbrows.com", "Taryn Brows | Brooklyn"], foot: "3 leads · 25% refused", share: 0.25, four: [], mark: "web" });
  assert.deepEqual(screenFor(card(search, "searched 'nyc florists'") as never).lines, ["search: nyc florists"]);
  assert.deepEqual(screenFor(card({ kind: "doc", domain: "", title: "Pricing in Brooklyn" }, "wrote note 'Pricing in Brooklyn'") as never).lines, ["wrote note 'Pricing in Brooklyn'"]);
  // the owner's four lines (creatorCC queue 233): output and goal, the item it is on, provider and freshness, the window
  const facts = { item: "Fiesta Lounge · Draft email", modelAgo: "2 min ago", model: { label: "api.z.ai/glm-4.5-flash", ts: "" }, window: { allowed: 9, total: 15 }, goal: 10, output: { label: "draft", today: 7 } };
  const writer = screenFor({ ...card(open), ...facts } as never);
  assert.deepEqual([writer.four, writer.mark], [["7 drafts today", "Fiesta Lounge · Draft email", "z.ai · 2m", "9/15 ok · 30m"], ""]);
  assert.equal(writer.foot, "25% refused"); // the count is line 1
  // no item and no goal: the page it is on, with the square; no actions in the window says so
  const plain = screenFor({ ...card(open), ...facts, item: "", goal: null, window: { allowed: 0, total: 0 } } as never);
  assert.deepEqual([plain.four[0], plain.four[1], plain.four[3], plain.mark], ["7 drafts today", "tarynbrows.com · Taryn Brows | Brooklyn", "no actions · 30m", "web"]);
  // resting: line 2 is until when and why, never the item
  const rested = screenFor({ ...card(open, "x", "resting until 14:40", "3 things blocked today"), ...facts } as never);
  assert.equal(rested.four[1], "until 14:40 · 3 things blocked today");
  const resting = screenFor(card(open, "x", "resting until 14:40", "3 things blocked today") as never);
  assert.deepEqual([resting.mode, resting.word, resting.lines], ["dark", "resting", ["until 14:40", "3 things blocked today"]]);
  // under 1024 px: two lines, no footer
  assert.deepEqual(screenFor(card(open) as never, { compact: true }), { mode: "web", name: "Lead Gen", word: "working", tone: "good", lines: ["tarynbrows.com"], foot: "", share: null, four: [], mark: "web" });
  assert.equal(screenFor({ ...card(open), output: null, refusedShare: null } as never).foot, "40 actions");
  // the counts line (queue 38, words in full since queue 221): the last word of the output's label, "refused" spelled out
  assert.equal(screenFor({ ...card(open), output: { label: "lead update", today: 4 }, refusedShare: 0.3 } as never).foot, "4 updates · 30% refused");
  assert.equal(screenFor({ ...card(open), output: { label: "package or task", today: 1 }, refusedShare: 0 } as never).foot, "1 task · 0% refused");
  // working after a rest (The CEO, 10-31): what it is doing and its plan step, never the rest's own word
  const ceo = screenFor({ ...card({ kind: "other", domain: "", title: "rest" }, "rested"), on: "Weekly OKR · step 2 of 3: score the leads" } as never);
  assert.deepEqual([ceo.word, ceo.lines], ["working", ["thinking…", "Weekly OKR · step 2 of 3: score the leads"]]);
  assert.deepEqual(screenFor(card({ kind: "other", domain: "", title: "update plan" }, "updated its plan") as never).lines, ["updating its plan"]);
});

test("screen: dark while resting or quiet, red when blocked, static on a model failure, dim when silent", () => {
  const last = { ts: "x", words: "opened a.com", ago: "", screen: { kind: "web", domain: "a.com", title: "A" } };
  const c = (word: string, l: unknown = last) => ({ name: "X", state: { word, tone: "muted", why: "" }, last: l, output: null, actionsToday: 0, refusedShare: null });
  assert.equal(screenFor(c("quiet") as never).mode, "dark");
  assert.equal(screenFor(c("blocked on The CEO's hold") as never).mode, "alert");
  assert.equal(screenFor(c("blocked on the model provider") as never, { noise: true }).mode, "static");
  assert.equal(screenFor(c("no heartbeat 25 min") as never).mode, "dim");
  assert.equal(screenFor(c("working", null) as never).mode, "dim");
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

test("member panel (queue 36): a click picks the tab only when the panel is closed; open, switching agents keeps it", async () => {
  // @ts-ignore TS5097
  const { panelNext } = await import("../lib/world.ts");
  type P = { open: boolean; tab: "info" | "screen" | "feed" | "chat" };
  const closed: P = { open: false, tab: "feed" };
  assert.deepEqual(panelNext(closed, "member"), { open: true, tab: "info" }, "closed, a member opens Info");
  assert.deepEqual(panelNext(closed, "screen"), { open: true, tab: "screen" }, "closed, a screen opens Screen");
  assert.deepEqual(panelNext(closed, "terminal"), { open: true, tab: "feed" }, "the terminal opens the panel on the web list and keeps the member tab");
  assert.deepEqual(panelNext({ open: true, tab: "info" }, "member"), { open: true, tab: "info" }, "open on Info, another member: still Info");
  assert.deepEqual(panelNext({ open: true, tab: "chat" }, "screen"), { open: true, tab: "chat" }, "open on Chat, a screen: still Chat");
  assert.deepEqual(panelNext({ open: true, tab: "screen" }, "member"), { open: true, tab: "screen" });
  // from the web view, a member click comes back on the last member tab
  assert.deepEqual(panelNext(panelNext({ open: true, tab: "chat" }, "terminal"), "member"), { open: true, tab: "chat" });
  let p: P = panelNext({ open: true, tab: "feed" }, "next");
  assert.deepEqual(p, { open: true, tab: "feed" }, "arrows keep the tab");
  p = panelNext(p, "close");
  assert.deepEqual(p, { open: false, tab: "feed" });
  p = panelNext(p, "expand");
  assert.deepEqual(p, { open: true, tab: "feed" }, "the strip expands on the tab it had");
});

test("under the tree (queue 37): five mats down its shade, then along the front edge; no two on one spot", () => {
  const spots = Array.from({ length: 12 }, (_, i) => bedSpot(i));
  assert.deepEqual(spots.slice(0, 5).map((p) => p.x), [21.75, 21.75, 21.75, 21.75, 21.75]);
  assert.ok(spots.slice(5).every((p) => p.y === 15.5 && p.x < 21.75));
  // the mat (26 px, drawn 13 px right of the spot's left edge) and its name inside the scene with a margin
  assert.ok(spots.every((p) => p.x * 16 + 13 + 13 <= 24 * 16 - 8));
  assert.equal(new Set(spots.map((p) => `${p.x},${p.y}`)).size, 12);
});

test("the terrace fits the family (queue 38): 8 is 4 + 4 centred, 9 is 5 + 4, 10 is 5 + 5; never an overlap", () => {
  const rows = (n: number) => {
    const ys = layout(n).map((p: { screen: { y: number } }) => p.screen.y);
    return [...new Set(ys)].map((y) => ys.filter((v: number) => v === y).length);
  };
  assert.deepEqual(rows(8), [4, 4]);
  assert.deepEqual(rows(9), [5, 4]);
  assert.deepEqual(rows(10), [5, 5]);
  assert.deepEqual(rows(3), [3]);
  // 8: centred left of the tree (the gap on either side within a quarter tile)
  const xs = layout(8).slice(0, 4).map((p: { screen: { x: number } }) => p.screen.x);
  const left = xs[0];
  const right = 21 - (xs[3] + SCREEN.w / TILE);
  assert.ok(Math.abs(left - right) <= 0.25, `left ${left}, right ${right}`);
  for (let n = 1; n <= 10; n++) {
    const r = layout(n).map((p: { screen: { x: number; y: number } }) => ({ x0: p.screen.x * TILE, y0: p.screen.y * TILE, x1: p.screen.x * TILE + SCREEN.w, y1: p.screen.y * TILE + SCREEN.h }));
    assert.equal(r.length, n);
    r.forEach((a, i) => r.forEach((b, j) => i < j && assert.ok(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0, `n=${n}: ${i} and ${j} overlap`)));
    assert.ok(r.every((a) => a.x0 >= 0 && a.x1 <= 21 * TILE), `n=${n}: inside the terrace, left of the tree`);
    // every place reachable from every other with that many walls
    for (const p of layout(n)) assert.ok(Number.isFinite(gridDistance(layout(n)[0].spot, p.spot, [], n)) && Number.isFinite(gridDistance(p.spot, TERMINAL, [], n)), `n=${n}: a place cut off`);
  }
});

test("the terrace (queue 37): ten screens without overlap, inside the scene, clear of the tree, the shore objects apart", () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ x0: x, y0: y, x1: x + w, y1: y + h });
  const screens = Array.from({ length: MAX_DESKS }, (_, i) => rect(slot(i).screen.x * TILE, slot(i).screen.y * TILE, SCREEN.w, SCREEN.h));
  const apart = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
  screens.forEach((a, i) => screens.forEach((b, j) => i < j && assert.ok(apart(a, b), `screens ${i} and ${j} overlap`)));
  assert.ok(screens.every((r) => r.x0 >= 0 && r.x1 <= COLS * TILE - 40 && r.y0 >= 5.25 * TILE && r.y1 <= ROWS * TILE), "inside the terrace, left of the tree");
  assert.equal(new Set(Array.from({ length: MAX_DESKS }, (_, i) => `${slot(i).spot.x},${slot(i).spot.y}`)).size, 10);
  assert.ok(SCREEN.w * SCREEN.h >= 3 * 26 * 16, "about three times the old monitor at least");
  const objects = [rect(MAILBOX.x * TILE, MAILBOX.y * TILE, MAILBOX.w * TILE, MAILBOX.h * TILE), rect(BULLETIN.x * TILE, BULLETIN.y * TILE, BULLETIN.w * TILE, BULLETIN.h * TILE), rect(TERMINAL_BOX.x, TERMINAL_BOX.y, TERMINAL_BOX.w, TERMINAL_BOX.h)];
  objects.forEach((a, i) => objects.forEach((b, j) => i < j && assert.ok(apart(a, b), `shore objects ${i} and ${j} overlap`)));
  objects.forEach((o) => screens.forEach((r) => assert.ok(apart(o, r), "a shore object over a screen")));
});

test("restarting: the bot stays at its place, not under the tree", () => {
  assert.equal(animOf({ word: "restarting" }), "idle");
});

test("WEB terminal badge and hover line (queue 33): pages opened today, 999+ past 999; the three counts in words", async () => {
  // @ts-ignore TS5097
  const { badgeText, webTitle, TERMINAL_BOX, TILE } = await import("../lib/world.ts");
  assert.equal(badgeText(0), "0");
  assert.equal(badgeText(241), "241");
  assert.equal(badgeText(1000), "999+");
  assert.equal(webTitle({ opens: 241, searches: 98, refused: 12 }), "241 pages opened, 98 searches, 12 refused today");
  assert.equal(webTitle({ opens: 1, searches: 1, refused: 0 }), "1 page opened, 1 search, 0 refused today");
  // the badge sits above the cabinet and inside the click box
  assert.ok(TERMINAL_BOX.y <= 4 * TILE + 2 - 8 && TERMINAL_BOX.x <= 22 * TILE + 1);
});

test("chat tab (queue 34): the owner right, the agent left in its colour; today HH:MM, else MM-DD HH:MM; the empty line", async () => {
  // @ts-ignore TS5097
  const { chatRows, chatEmpty, hasChat, lookOf } = await import("../lib/world.ts");
  assert.equal(hasChat("lead-gen"), true);
  assert.equal(hasChat("validator"), false, "the Validator never answers a chat line");
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const rows = chatRows(
    [
      { ts: "2026-10-30T18:02:00", from: "Owner", text: "Any replies?" },
      { ts: "2026-10-31T09:15:00", from: "Lead Gen", text: "None yet." },
    ],
    "lead-gen",
    now,
  );
  assert.deepEqual(rows, [
    { side: "owner", time: "10-30 18:02", text: "Any replies?", color: null },
    { side: "agent", time: "09:15", text: "None yet.", color: lookOf("lead-gen").shirt },
  ]);
  assert.equal(chatEmpty("Lead Gen"), "Nothing yet. Write to Lead Gen; it answers here, usually within seconds.");
});

test("labels (queue 42): a thought bubble or a stuck tag never covers a screen, for every place of 8 and 10 members", async () => {
  // @ts-ignore TS5097
  const { labelRects, layout, SCREEN, TILE, COLS, ROWS } = await import("../lib/world.ts");
  const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const n of [8, 10]) {
    const places = layout(n);
    const screens = places.map((p: { screen: { x: number; y: number } }) => ({ x: p.screen.x * TILE, y: p.screen.y * TILE, w: SCREEN.w, h: SCREEN.h }));
    places.forEach((p: { spot: { x: number; y: number } }, i: number) => {
      const feet = { x: p.spot.x * TILE + 8, y: p.spot.y * TILE + 16 };
      const { bubble, tag } = labelRects(feet, 118); // the widest bubble
      for (const r of [bubble, tag]) {
        screens.forEach((s: { x: number; y: number; w: number; h: number }, j: number) => assert.ok(!hit(r, s), `n=${n}: member ${i}'s label covers screen ${j}`));
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= COLS * TILE && r.y + r.h <= ROWS * TILE, `n=${n}: member ${i}'s label leaves the scene`);
      }
      assert.ok(!hit(bubble, tag), "bubble and tag apart");
    });
  }
});

test("resting screen (queue 42): the header says resting, line 2 until when, line 3 why", () => {
  const s = screenFor({ name: "Package Designer", state: { word: "resting until 12:27", tone: "muted", why: "9 things blocked today" }, last: null, output: null, actionsToday: 0, refusedShare: null } as never);
  assert.deepEqual([s.word, s.mode, s.lines], ["resting", "dark", ["until 12:27", "9 things blocked today"]]);
});

test("the Web list notes a reason only under refused, captcha and empty rows (queue 44)", () => {
  assert.equal(webNote({ mark: "refused", reason: "same search as earlier today" }), "same search as earlier today");
  assert.equal(webNote({ mark: "captcha", reason: "captcha or access wall" }), "captcha or access wall");
  assert.equal(webNote({ mark: "empty", reason: "empty page" }), "empty page");
  assert.equal(webNote({ mark: "ok", reason: "anything" }), null);
  assert.equal(webNote({ mark: "refused", reason: "" }), null);
});

// queue 45: nobody walks through a screen, a wall or a shore object
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const cellsOf = (from: { x: number; y: number }, path: { x: number; y: number }[]) => {
  const out = [{ ...from }];
  let at = from;
  for (const q of path) {
    const steps = Math.round((Math.abs(q.x - at.x) + Math.abs(q.y - at.y)) / 0.25);
    assert.ok(q.x === at.x || q.y === at.y, `a diagonal leg ${JSON.stringify(at)} -> ${JSON.stringify(q)}`);
    for (let k = 1; k <= steps; k++) out.push({ x: at.x + ((q.x - at.x) * k) / steps, y: at.y + ((q.y - at.y) * k) / steps });
    at = q;
  }
  return out;
};
const inFoot = (p: { x: number; y: number }, f: { x0: number; y0: number; x1: number; y1: number }) => p.x > f.x0 && p.x < f.x1 && p.y > f.y0 && p.y < f.y1;

test("every spot, shore place, mat and object can be reached, and no path cell is inside an object", () => {
  for (const n of [1, 3, 5, 8, 9, 10]) {
    const beds = Array.from({ length: MAX_DESKS - n }, (_, i) => bedSpot(i));
    const spots = layout(n).map((p) => p.spot);
    const errands = [POST_SPOT, NOTICE_SPOT, TERMINAL, ...Array.from({ length: 5 }, (_, i) => shoreSeat(i))];
    const feet = obstacles(n).map((o) => o.foot);
    const check = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const path = route(from, to, beds, n);
      assert.ok(near(path[path.length - 1], to), `n=${n}: no path ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
      assert.ok(Number.isFinite(gridDistance(from, to, beds, n)), `n=${n}: unreachable ${JSON.stringify(to)}`);
      for (const c of cellsOf(from, path)) {
        const hit = feet.find((f) => inFoot(c, f));
        assert.ok(!hit, `n=${n}: ${JSON.stringify(from)} -> ${JSON.stringify(to)} crosses ${JSON.stringify(hit)} at ${JSON.stringify(c)}`);
        const mat = beds.find((b) => !near(b, from) && !near(b, to) && Math.abs(c.x - b.x) < 0.85 && c.y > b.y - 0.35 && c.y < b.y + 0.45);
        assert.ok(!mat, `n=${n}: crosses the mat at ${JSON.stringify(mat)}`);
      }
      return path;
    };
    for (const s of spots) {
      for (const e of [...errands, ...beds]) {
        check(s, e);
        check(e, s);
      }
    }
    if (n >= 8) for (const a of spots) for (const b of spots) if (a !== b) check(a, b);
  }
});

test("the walking grid is exactly the drawn objects' footprints (one source for both)", () => {
  for (const n of [4, 8, 10]) {
    const beds = [bedSpot(0), bedSpot(6)];
    const obs = obstacles(n);
    // each screen's footprint covers the screen as drawn, its posts and its wall
    layout(n).forEach((place, i) => {
      const d = placeDrawn(place);
      const o = obs.find((x) => x.name === `screen ${i}`)!;
      for (const part of [d.screen, d.posts, d.wall]) {
        assert.ok(part.x >= o.px.x && part.x + part.w <= o.px.x + o.px.w && part.y >= o.px.y && part.y + part.h <= o.px.y + o.px.h, `screen ${i} misses a drawn part`);
      }
      assert.equal(d.screen.x, place.screen.x * TILE - 1);
      assert.equal(d.wall.y, (place.spot.y + 1) * TILE - 14, "the wall world-view draws");
    });
    for (let j = 0; j < 44; j++) {
      for (let i = 0; i < COLS * 4; i++) {
        const p = { x: i / 4, y: 5 + j / 4 };
        const blocked = p.y < 5.1 || p.y > ROWS - 1 || obs.some((o) => inFoot(p, o.foot)) || beds.some((b) => p.x > b.x - 0.85 && p.x < b.x + 0.85 && p.y > b.y - 0.35 && p.y < b.y + 0.45);
        assert.equal(freeAt(p, beds, n), !blocked, `n=${n} ${JSON.stringify(p)}`);
      }
    }
  }
  // a figure standing where it may never overlaps an object with its feet inside the object's height
  for (const o of obstacles(8)) {
    for (let j = 0; j < 44; j++)
      for (let i = 0; i < COLS * 4; i++) {
        const p = { x: i / 4, y: 5 + j / 4 };
        if (!freeAt(p, [], 8)) continue;
        const fx = p.x * TILE + 8;
        const fy = (p.y + 1) * TILE;
        const overlapsX = fx + 6 > o.px.x && fx - 6 < o.px.x + o.px.w;
        assert.ok(!(overlapsX && fy > o.px.y && fy < o.px.y + o.px.h), `${o.name}: a figure at ${JSON.stringify(p)} stands in it`);
      }
  }
});

test("depth: shore figures behind the terrace, a figure in front of its own wall and screen, near the board and the sign", () => {
  const places = layout(8);
  const board = { x: BULLETIN.x * TILE, y: BULLETIN.y * TILE + 32 }; // the board's foot
  const sign = { x: SIGNBOARD.x + 13, y: SIGNBOARD.y + 34 };
  // the four places nearest the notice board and the signboard
  const byDist = (q: { x: number; y: number }) => [...places].sort((a, b) => Math.hypot(a.screen.x * TILE - q.x, a.screen.y * TILE - q.y) - Math.hypot(b.screen.x * TILE - q.x, b.screen.y * TILE - q.y));
  const nearest = [...new Set([...byDist(board).slice(0, 2), ...byDist(sign).slice(0, 2)])];
  assert.ok(nearest.length >= 3);
  for (const shoreSpot of [NOTICE_SPOT, TERMINAL]) {
    assert.ok(figureKey(shoreSpot) > board.y && figureKey(shoreSpot) > sign.y, "in front of the shore objects it stands at");
    for (const pl of places) assert.ok(figureKey(shoreSpot) < screenKey(pl) && figureKey(shoreSpot) < wallKey(pl), "behind every terrace object");
  }
  for (const pl of nearest) {
    assert.ok(figureKey(pl.spot) > screenKey(pl) && figureKey(pl.spot) > wallKey(pl), "a member in front of its own screen and wall");
    // a walker on the walk below the row is in front of it, one on the shore path behind it
    assert.ok(figureKey({ x: pl.spot.x, y: pl.spot.y + 0.5 }) > screenKey(pl));
    assert.ok(figureKey({ x: pl.spot.x, y: 5.5 }) < screenKey(pl));
  }
});

test("leaving its spot for the shore, a member steps sideways into a gap first, never up through its screen", () => {
  for (const n of [5, 8, 10]) {
    for (const place of layout(n)) {
      for (const to of [POST_SPOT, NOTICE_SPOT, TERMINAL]) {
        const first = route(place.spot, to, [], n)[0];
        assert.equal(first.y, place.spot.y, `n=${n}: from ${JSON.stringify(place.spot)} it first goes to ${JSON.stringify(first)}`);
      }
    }
  }
});

// queue 46: three planes in the air, first in, first out
test("planes: the seed is the newest three of the last 24 h, oldest first, with no take-off; fewer messages, fewer planes", async () => {
  // @ts-ignore TS5097
  const { newAir, airPoll, aloft, inTheAir } = await import("../lib/world.ts");
  const now = new Date(2026, 9, 31, 14, 0, 0).getTime();
  const msg = (id: string, ts: string, from = "Lead Gen", to = "The CEO") => ({ id, ts, from, to, text60: `text ${id}` });
  const five = [msg("e", "2026-10-31T13:50:00"), msg("d", "2026-10-31T12:00:00"), msg("c", "2026-10-31T09:00:00"), msg("b", "2026-10-30T20:00:00"), msg("a", "2026-10-30T13:00:00")];
  const air = newAir();
  assert.deepEqual(airPoll(air, five, now, { instant: false }), [], "no take-off on load");
  assert.deepEqual(aloft(air).map((f: { msg: { id: string } }) => f.msg.id), ["c", "d", "e"]);
  assert.ok(air.flights.every((f: { phase: string }) => f.phase === "loop"));
  // a quiet day: two in 24 h, two planes, never a made-up third
  assert.deepEqual(inTheAir([msg("x", "2026-10-31T10:00:00"), msg("y", "2026-10-31T11:00:00"), msg("old", "2026-10-29T10:00:00")], now).map((m: { id: string }) => m.id), ["x", "y"]);
  const few = newAir();
  airPoll(few, [msg("x", "2026-10-31T10:00:00"), msg("old", "2026-10-29T10:00:00")], now, { instant: false });
  assert.equal(aloft(few).length, 1);
  // a new message with fewer than three up lands nothing
  airPoll(few, [msg("z", "2026-10-31T13:59:00"), msg("x", "2026-10-31T10:00:00"), msg("old", "2026-10-29T10:00:00")], now + 5000, { instant: false });
  assert.deepEqual(few.flights.map((f: { msg: { id: string }; phase: string }) => [f.msg.id, f.phase]), [["x", "loop"], ["z", "takeoff"]]);
});

test("planes: a fourth message takes off as the oldest of three lands; take-off joins the loop, landing vanishes", async () => {
  // @ts-ignore TS5097
  const { newAir, airPoll, airStep, aloft, TAKEOFF_MS, LANDING_MS } = await import("../lib/world.ts");
  const now = new Date(2026, 9, 31, 14, 0, 0).getTime();
  const msg = (id: string, ts: string) => ({ id, ts, from: "Research Analyst", to: "The CEO", text60: id });
  const msgs = [msg("c", "2026-10-31T13:00:00"), msg("b", "2026-10-31T12:00:00"), msg("a", "2026-10-31T11:00:00")];
  const air = newAir();
  airPoll(air, msgs, now, { instant: false });
  const took = airPoll(air, [msg("d", "2026-10-31T14:00:30"), ...msgs], now + 1000, { instant: false });
  assert.deepEqual(took.map((m: { id: string }) => m.id), ["d"]);
  const phase = () => Object.fromEntries(air.flights.map((f: { msg: { id: string }; phase: string }) => [f.msg.id, f.phase]));
  assert.deepEqual(phase(), { a: "landing", b: "loop", c: "loop", d: "takeoff" }, "the oldest leaves at the same moment");
  assert.deepEqual(aloft(air).map((f: { msg: { id: string } }) => f.msg.id), ["b", "c", "d"], "b lands next, d is the newest");
  airStep(air, now + 1000 + Math.max(TAKEOFF_MS, LANDING_MS));
  assert.deepEqual(phase(), { b: "loop", c: "loop", d: "loop" });
  // the same poll again changes nothing; two new at once land the two oldest, in order
  airPoll(air, [msg("d", "2026-10-31T14:00:30"), ...msgs], now + 9000, { instant: false });
  assert.equal(air.flights.length, 3);
  airPoll(air, [msg("f", "2026-10-31T14:02:00"), msg("e", "2026-10-31T14:01:00"), msg("d", "2026-10-31T14:00:30"), ...msgs].slice(0, 5), now + 10_000, { instant: false });
  assert.deepEqual(phase(), { b: "landing", c: "landing", d: "loop", e: "takeoff", f: "takeoff" });
  assert.deepEqual(aloft(air).map((f: { msg: { id: string } }) => f.msg.id), ["d", "e", "f"]);
});

test("planes: reduced motion and quiet put the new plane straight in the loop and drop the oldest; planes hover in place", async () => {
  // @ts-ignore TS5097
  const { newAir, airPoll } = await import("../lib/world.ts");
  const now = new Date(2026, 9, 31, 14, 0, 0).getTime();
  const msg = (id: string, ts: string) => ({ id, ts, from: "Owner", to: "Scout", text60: id });
  const msgs = [msg("c", "2026-10-31T13:00:00"), msg("b", "2026-10-31T12:00:00"), msg("a", "2026-10-31T11:00:00")];
  const air = newAir();
  airPoll(air, msgs, now, { instant: true });
  airPoll(air, [msg("d", "2026-10-31T13:30:00"), ...msgs], now + 1000, { instant: true });
  assert.deepEqual(air.flights.map((f: { msg: { id: string }; phase: string }) => [f.msg.id, f.phase]), [["b", "loop"], ["c", "loop"], ["d", "loop"]]);
});

test("planes: the ribbon says handles only, the hover the whole line; the take-off's legs", async () => {
  // @ts-ignore TS5097
  const { airLabel, captionOf, takeoffLeg } = await import("../lib/world.ts");
  const handles: Record<string, string> = { "Outreach Writer": "outA", "The CEO": "ceoA", Scout: "scoA" };
  const h = (n: string) => handles[n] ?? n;
  const m = (from: string, to: string) => ({ id: "x", ts: "2026-10-31T12:42:44", from, to, text60: "Do you have any research questions for me today?" });
  assert.equal(airLabel(m("Outreach Writer", "The CEO"), h), "outA → ceoA");
  assert.equal(airLabel(m("Outreach Writer", "everyone"), h), "outA → all");
  assert.equal(airLabel(m("Scout", "Owner"), h), "scoA → owner");
  assert.equal(airLabel(m("Owner", "Scout"), h), "owner → scoA");
  assert.equal(captionOf(m("Research Analyst", "The CEO")), "Research Analyst → The CEO · 12:42");
  assert.equal(takeoffLeg(0.1).leg, "out");
  assert.equal(takeoffLeg(0.5).leg, "touch");
  assert.equal(takeoffLeg(0.9).leg, "up");
  assert.equal(takeoffLeg(1).k, 1);
});

test("a working bot retrying a failed call says so on line 4 (queue 49)", () => {
  const c = card("lead-gen", { state: { word: "working", tone: "good", why: "1 failed call, retrying" } });
  const s = screenFor(c as never);
  assert.equal(s.foot, "1 failed call, retrying");
  assert.equal(s.tone, "good");
  assert.notEqual(screenFor(card("lead-gen") as never).foot, "1 failed call, retrying");
  assert.equal(screenFor(c as never, { compact: true }).foot, "");
});

// queue 47 part 2: one personality per member, carried by a prop and a signature move
test("personalities: each member's props, and the move its real actions play", async () => {
  // @ts-ignore TS5097
  const { gearOf, moveOf, actAnim } = await import("../lib/world.ts");
  assert.deepEqual(gearOf("the-ceo"), ["clipboard", "watch"]);
  assert.deepEqual(gearOf("lead-gen"), ["binoculars"]);
  assert.deepEqual(gearOf("lead-enricher"), ["magnifier"]);
  assert.deepEqual(gearOf("outreach-writer"), ["pencil"]);
  assert.deepEqual(gearOf("package-designer"), ["sketchpad"]);
  assert.deepEqual(gearOf("research-analyst"), ["book", "glasses"]);
  assert.deepEqual(gearOf("scout"), ["backpack", "compass"]);
  assert.deepEqual(gearOf("onion-reader"), ["trenchcoat", "umbrella"]);
  assert.deepEqual(gearOf("validator"), [], "the Validator stays a bird");
  const move = (slug: string, type: string, verdict = "allowed") => moveOf(slug, actAnim({ type, verdict }) ?? "puff");
  assert.equal(move("lead-gen", "search"), "sweep");
  assert.equal(move("lead-enricher", "update_lead"), "magnify");
  assert.equal(move("outreach-writer", "update_lead"), "toss");
  assert.equal(move("package-designer", "publish_package"), "holdup");
  assert.equal(move("research-analyst", "note"), "glasses");
  assert.equal(move("scout", "search"), "compass");
  assert.equal(move("the-ceo", "task"), "watch");
  assert.equal(move("lead-gen", "search", "refused"), null, "a refusal keeps its red puff");
  assert.equal(move("lead-gen", "message"), null, "a message stays a plane");
});

test("the Writer's bin: a ball per accepted draft today, capped, empty at midnight, only the Writer's", async () => {
  // @ts-ignore TS5097
  const { binCount, BIN_MAX } = await import("../lib/world.ts");
  assert.equal(binCount({ slug: "outreach-writer", output: { label: "draft", today: 4 } }), 4);
  assert.equal(binCount({ slug: "outreach-writer", output: { label: "draft", today: 31 } }), BIN_MAX);
  assert.equal(binCount({ slug: "outreach-writer", output: { label: "draft", today: 0 } }), 0, "a new day's count starts at 0");
  assert.equal(binCount({ slug: "lead-gen", output: { label: "lead", today: 9 } }), 0);
  assert.equal(binCount({ slug: "outreach-writer", output: null }), 0);
});

test("props persist in every pose and fit the portrait; the umbrella opens in the rain", async () => {
  // @ts-ignore TS5097
  const { personaRects, PERSONAS, gearRects, gearOf } = await import("../lib/world.ts");
  for (const slug of Object.keys(PERSONAS)) {
    for (const pose of ["stand", "walk", "sit", "type", "use", "lie"]) assert.ok(personaRects(slug, pose).length > 0, `${slug} ${pose}`);
    // the portrait draws the standing figure with its feet at (11, 25) on a 24 x 26 canvas
    for (const [dx, dy, w, h] of personaRects(slug, "stand")) assert.ok(11 + dx >= 0 && 11 + dx + w <= 24 && 25 + dy >= 0 && 25 + dy + h <= 26, `${slug} off the portrait`);
    // each held or worn prop is at least 4 px in one direction, so it reads at a glance (queue 52)
    for (const g of gearOf(slug)) if (g !== "watch" && g !== "glasses") assert.ok(gearRects(g, "stand").some(([, , w, h]) => Math.max(w, h) >= 4), `${slug} ${g} too small`);
  }
  assert.notDeepEqual(gearRects("umbrella", "stand", { rain: true }), gearRects("umbrella", "stand"));
  assert.deepEqual(gearRects("binoculars", "stand", { held: false }), gearRects("binoculars", "stand"), "worn on a strap, not in the hand");
  assert.deepEqual(gearRects("magnifier", "stand", { held: false }), [], "a move raises what is in the hand");
});

// queue 47 part 5: made for video
test("director: whoever acted gets the inset for 3 s, then the next; nobody acting pans; gone members are skipped", async () => {
  // @ts-ignore TS5097
  const { newDirector, directorStep, insetSource, panAt, DIRECTOR_HOLD_MS } = await import("../lib/world.ts");
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
  // a member that left the terrace is skipped
  assert.equal(directorStep(newDirector(), 0, ["validator", "scout"], all).focus, "scout");
  // the inset: a sixth of the scene (2x of a third), on the head, inside the scene; the pan sweeps and comes back
  const r = insetSource({ x: 200, y: 150 }, 0);
  assert.deepEqual([r.w, r.h], [64, 256 / 6]);
  assert.ok(r.x + r.w / 2 === 200 && r.y + r.h / 2 === 140);
  const edge = insetSource({ x: 2, y: 250 }, 0);
  assert.ok(edge.x === 0 && edge.y + edge.h === 256, "clamped");
  assert.ok(panAt(0) === 0 && Math.abs(panAt(30_000) - 1) < 1e-9 && Math.abs(panAt(60_000)) < 1e-9);
});

test("ticker: live numbers from the board, the scroll pauses under the pointer", async () => {
  // @ts-ignore TS5097
  const { tickerText, tickerScroll, TICKER_SPEED } = await import("../lib/world.ts");
  const cards = [
    { output: { label: "lead", today: 35 }, refusedShare: 0.2, actionsToday: 100 },
    { output: { label: "draft", today: 14 }, refusedShare: 0.5, actionsToday: 40 },
    { output: { label: "note", today: 57 }, refusedShare: 0, actionsToday: 60 },
    { output: null, refusedShare: null, actionsToday: 0 },
  ];
  assert.equal(tickerText(cards, 546, 3), "Leads today 35   ·   Drafts today 14   ·   Pages opened 546   ·   Refused 20% of actions   ·   In the air 3");
  assert.equal(tickerText([], null, 0), "Leads today 0   ·   Drafts today 0   ·   Pages opened -   ·   Refused 0% of actions   ·   In the air 0");
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

test("the video strip covers nothing: no screen, figure or label under the inset or the ticker (queue 50)", async () => {
  // @ts-ignore TS5097
  const { videoLayout, labelRects, tickerText } = await import("../lib/world.ts");
  const meets = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.deepEqual(videoLayout({ director: false, ticker: false }), { height: ROWS * TILE, inset: null, caption: null, ticker: null });
  for (const v of [{ director: true, ticker: false }, { director: false, ticker: true }, { director: true, ticker: true }]) {
    const L = videoLayout(v);
    assert.ok(L.height > ROWS * TILE && Number.isInteger(L.height));
    for (const n of [1, 5, 8, 10]) {
      for (const place of layout(n)) {
        const d = placeDrawn(place);
        for (const part of [d.screen, d.posts, d.wall]) {
          if (L.inset) assert.ok(!meets(L.inset, part), `inset over a screen (n=${n})`);
          if (L.ticker) assert.ok(!meets(L.ticker, part), `ticker over a screen (n=${n})`);
        }
      }
    }
    // every place a figure can stand: its sprite (12 x 24 above the feet) and its bubble and tag
    for (let j = 0; j < 44; j++)
      for (let i = 0; i < COLS * 4; i++) {
        const p = { x: i / 4, y: 5 + j / 4 };
        if (!freeAt(p, [], 8)) continue;
        const fx = p.x * TILE + 8;
        const fy = (p.y + 1) * TILE;
        const sprite = { x: fx - 6, y: fy - 24, w: 12, h: 25 };
        const { bubble, tag } = labelRects({ x: fx, y: fy }, 120);
        for (const box of [L.inset, L.caption, L.ticker]) {
          if (!box) continue;
          for (const thing of [sprite, bubble, tag]) assert.ok(!meets(box, thing), `${JSON.stringify(box)} over ${JSON.stringify(thing)} at ${JSON.stringify(p)}`);
        }
      }
    if (L.inset && L.ticker) assert.ok(L.ticker.y >= L.inset.y + L.inset.h, "the ticker under the inset");
    if (L.ticker) assert.equal(L.ticker.w, COLS * TILE, "the ticker along the whole width");
  }
  assert.match(tickerText([{ output: null, refusedShare: 0.31, actionsToday: 100 }], 1, 0), /Refused 31% of actions/);
});

test("free flight: waypoints inside the scene, planes a tile apart, never stopping, gentle turns; reduced motion drifts in place", async () => {
  // @ts-ignore TS5097
  const { newAir, airPoll, airStep, wanderAt, separate, AIR_BOX, AIR_GAP } = await import("../lib/world.ts");
  const msg = (id: string, ts: string) => ({ id, ts, from: "Lead Gen", to: "The CEO", text60: id });
  const now0 = 0; // the page clock (performance.now): polls and frames share it
  const air = newAir();
  airPoll(air, [msg("c", "2026-10-31T14:50:00"), msg("b", "2026-10-31T14:40:00"), msg("a", "2026-10-31T14:30:00")], now0, { instant: false });
  const W = COLS * TILE;
  const H = ROWS * TILE;
  let prev: { x: number; y: number }[] | null = null;
  let still = 0;
  for (let t = 0; t <= 30 * 60_000; t += 250) {
    airStep(air, t);
    for (const f of air.flights) {
      for (const q of [f.wander.a, f.wander.b]) assert.ok(q.x >= AIR_BOX.x0 && q.x <= AIR_BOX.x1 && q.y >= AIR_BOX.y0 && q.y <= AIR_BOX.y1, `waypoint ${JSON.stringify(q)}`);
      assert.ok(f.wander.dur >= 6000 && f.wander.dur <= 10_000);
    }
    const ps = separate(air.flights.map((f) => wanderAt(f.wander, t, false)));
    for (const p of ps) assert.ok(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H, `inside the scene (so never under the panel): ${JSON.stringify(p)}`);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) >= AIR_GAP - 1e-6, `too close at ${t}`);
    if (prev && t % 2000 === 0) for (let i = 0; i < ps.length; i++) if (Math.hypot(ps[i].x - prev[i].x, ps[i].y - prev[i].y) < 0.5) still++;
    if (t % 2000 === 0) prev = ps;
  }
  assert.equal(still, 0, `planes kept flying (${still} near-still 2 s samples)`);
  // the heading turns smoothly: no jump over 0.35 rad in a quarter second
  const w = air.flights[0].wander;
  let last = wanderAt(w, w.start, false).angle;
  for (let t = w.start; t < w.start + w.dur; t += 250) {
    const a = wanderAt(w, t, false).angle;
    let d = Math.abs(a - last) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    assert.ok(d <= 0.35, `turn of ${d} rad`);
    last = a;
  }
  // a replay flies the same paths
  const again = newAir();
  airPoll(again, [msg("c", "2026-10-31T14:50:00"), msg("b", "2026-10-31T14:40:00"), msg("a", "2026-10-31T14:30:00")], now0, { instant: false });
  for (let t = 0; t <= 30 * 60_000; t += 250) airStep(again, t);
  assert.deepEqual(again.flights.map((f: { wander: unknown }) => f.wander), air.flights.map((f: { wander: unknown }) => f.wander));
  // reduced motion: a slow drift around one place
  const a0 = wanderAt(w, 0, true);
  for (let t = 0; t < 20_000; t += 500) {
    const q = wanderAt(w, t, true);
    assert.ok(Math.hypot(q.x - a0.x, q.y - a0.y) <= 5);
  }
  // separate() itself: two planes on top of each other end a tile apart
  const [s1, s2] = separate([{ x: 100, y: 100 }, { x: 101, y: 100 }]);
  assert.ok(Math.hypot(s1.x - s2.x, s1.y - s2.y) >= AIR_GAP);
});

test("bees and butterflies: a bee for the owner's lines and replies to the owner, a butterfly in the family's colour otherwise (queue 51)", async () => {
  // @ts-ignore TS5097
  const { flyerOf, wingColor, beeBob, insectPose, lookOf } = await import("../lib/world.ts");
  assert.equal(flyerOf({ from: "Owner", to: "Scout" }), "bee");
  assert.equal(flyerOf({ from: "Scout", to: "Owner" }), "bee");
  assert.equal(flyerOf({ from: "The CEO", to: "everyone" }), "butterfly");
  assert.equal(flyerOf({ from: "Research Analyst", to: "The CEO" }), "butterfly");
  const cards = [{ slug: "the-ceo", name: "The CEO" }];
  assert.equal(wingColor("The CEO", cards), lookOf("the-ceo").shirt);
  assert.equal(wingColor("Owner", cards), "#ff6600");
  assert.equal(wingColor("Someone Gone", cards), "#8a8a8a");
  // the bee: a 1 px bob, no zigzag; it flips with its way and leans at most 15 degrees, never spinning
  for (let t = 0; t < 5000; t += 50) assert.ok(Math.abs(beeBob(7, t)) <= 1);
  assert.deepEqual(insectPose(0), { face: 1, tilt: 0 });
  assert.equal(insectPose(Math.PI).face, -1);
  assert.ok(Math.abs(insectPose(Math.PI / 2).tilt - (15 * Math.PI) / 180) < 1e-9, "a climb leans 15 degrees, no more");
  for (let a = -Math.PI; a <= Math.PI; a += 0.1) assert.ok(Math.abs(insectPose(a).tilt) <= (15 * Math.PI) / 180 + 1e-9);
});

test("a butterfly's or bee's card: names, time, the first 120 characters, inside the scene by the insect; a 16 px box finds it (queue 51)", async () => {
  // @ts-ignore TS5097
  const { insectCard, cardRect, insectAt, CARD_W } = await import("../lib/world.ts");
  const long = "Understood, CEO. I am prioritizing focused, direct research queries to maintain high quality and minimize blocked items.";
  assert.deepEqual(insectCard({ id: "x", ts: "2026-10-31T12:42:44", from: "Research Analyst", to: "The CEO", text60: long.slice(0, 60), text120: long.slice(0, 120) }), ["Research Analyst → The CEO", "12:42", long.slice(0, 120)]);
  assert.equal(insectCard({ id: "y", ts: "2026-10-31T09:05:00", from: "Owner", to: "Scout", text60: "short" })[2], "short", "an older payload without text120");
  for (const at of [{ x: 2, y: 3 }, { x: 380, y: 250 }, { x: 190, y: 120 }, { x: 0, y: 0 }])
    for (const h of [29, 43]) {
      const r = cardRect(at, h);
      assert.ok(r.x >= 0 && r.x + r.w <= 384 && r.y >= 0 && r.y + r.h <= 256, `inside the scene for ${JSON.stringify(at)}`);
      assert.ok(Math.abs(r.x + CARD_W / 2 - at.x) <= CARD_W / 2 + 2, "by the insect");
      assert.ok(r.y + r.h <= at.y - 10 || r.y >= at.y + 10, "not over it");
    }
  const shown = [{ x: 100, y: 50, id: "a" }, { x: 112, y: 50, id: "b" }];
  assert.equal(insectAt(shown, 107, 57)?.id, "b", "the nearest in its 16 px box");
  assert.equal(insectAt(shown, 100, 60), null, "outside the box");
  assert.equal(insectAt(shown, 92, 42)?.id, "a", "a generous box: 8 px each way");
});

test("the Info card's first line names the gear (queue 52)", async () => {
  // @ts-ignore TS5097
  const { gearWords } = await import("../lib/world.ts");
  assert.equal(gearWords("lead-gen"), "binoculars");
  assert.equal(gearWords("onion-reader"), "trench coat & umbrella");
  assert.equal(gearWords("validator"), "");
  assert.equal(dialogue(card("lead-gen") as never).title, "Lead Gen leaA · binoculars");
});

// queue 53: busy between steps
test("busy between steps: only while working, from the last action and the member's own prop; any other state stops it", async () => {
  // @ts-ignore TS5097
  const { busyOf, busyKindOf } = await import("../lib/world.ts");
  // the loop a last action leads to
  assert.equal(busyKindOf("lead-gen", "search"), "scan");
  assert.equal(busyKindOf("lead-gen", "open"), "tablet");
  assert.equal(busyKindOf("outreach-writer", "update_lead"), "type");
  assert.equal(busyKindOf("the-ceo", "message"), "look");
  assert.equal(busyKindOf("the-ceo", "task"), "clipboard");
  assert.equal(busyKindOf("package-designer", "package"), "sketch");
  assert.equal(busyKindOf("research-analyst", "read"), "page");
  assert.equal(busyKindOf("lead-enricher", "update_lead"), "magnify");
  assert.equal(busyKindOf("scout", "search"), "scan");
  // the prop it keeps at
  const at = (slug: string, actType: string, t = 7000) => busyOf({ slug, anim: "working", actType, t, still: false, playing: false });
  assert.equal(at("scout", "search")?.prop, "compass");
  assert.equal(at("lead-gen", "search")?.prop, "sweep");
  assert.equal(at("lead-gen", "open")?.prop, "tablet");
  assert.equal(busyOf({ slug: "the-ceo", anim: "working", actType: "message", t: 7000, still: false, playing: false, toward: -1 })?.facing, -1, "looks toward the one it wrote to");
  // typing comes in bursts
  const poses = new Set(Array.from({ length: 20 }, (_, i) => at("outreach-writer", "update_lead", 7000 + i * 125)?.pose));
  assert.ok(poses.has("type") && poses.has("stand"));
  // only while working, and never over a real action
  for (const anim of ["resting", "idle", "quiet", "blocked", "lost"] as const) assert.equal(busyOf({ slug: "lead-gen", anim, actType: "search", t: 7000, still: false, playing: false }), null, anim);
  assert.equal(busyOf({ slug: "lead-gen", anim: "working", actType: "search", t: 7000, still: false, playing: true }), null, "a real action wins");
  // reduced motion: the pose holds, no prop moving
  assert.deepEqual(busyOf({ slug: "lead-gen", anim: "working", actType: "search", t: 7000, still: true, playing: false }), { what: "scan", pose: "stand", prop: null, k: 0, facing: null, dx: 0 });
  // a little life every 10-20 s, 1.5 s long: stretch, sip or two steps and back
  const lives: number[] = [];
  let inLife = false;
  for (let t = 0; t < 120_000; t += 100) {
    const b = at("lead-gen", "search", t);
    const life = b?.what === "stretch" || b?.what === "sip" || b?.what === "pace";
    if (life && !inLife) lives.push(t);
    inLife = !!life;
  }
  const gaps = lives.slice(1).map((v, i) => v - lives[i]);
  assert.ok(lives.length >= 6 && gaps.every((g) => g >= 10_000 && g <= 20_000), `life at ${lives.join(", ")}`);
});

test("the butterfly: mirror-symmetric open wings with a notch, outlined, antennae with tips, a 3-frame flap, the marker clear of the head (queue 58)", async () => {
  // @ts-ignore TS5097
  const { butterflyPixels, flapFrame, butterflyHop } = await import("../lib/world.ts");
  const open = butterflyPixels("open", true);
  const set = (ps: [number, number][]) => new Set(ps.map(([x, y]) => `${x},${y}`));
  for (const layer of ["wing", "outline", "spots", "antennae", "tips"] as const) {
    const s = set(open[layer]);
    for (const [x, y] of open[layer]) assert.ok(s.has(`${-x},${y}`), `${layer} ${x},${y} mirrored`);
  }
  const xs = [...open.wing, ...open.outline].map(([x]: [number, number]) => x);
  assert.equal(Math.max(...xs) - Math.min(...xs) + 1, 13, "13 px across");
  // two lobes: the notch row has fewer wing pixels than the rows above and below it
  const row = (y: number) => open.wing.filter((p: [number, number]) => p[1] === y).length;
  assert.ok(row(0) < row(-1) && row(0) < row(1), "a notch between upper and lower wing");
  assert.ok(row(-3) > row(2), "the upper lobe is the larger");
  assert.ok(open.outline.length > open.wing.length / 2, "an outline round the wings");
  // antennae from the head (y -4) up, each ending in a tip
  assert.ok(open.antennae.length >= 4 && open.antennae.every(([, y]: [number, number]) => y < -4));
  assert.equal(open.tips.length, 2);
  for (const [tx, ty] of open.tips) assert.ok(open.antennae.some(([ax, ay]: [number, number]) => Math.abs(ax - tx) <= 1 && Math.abs(ay - ty) <= 1), "a tip on an antenna");
  // the "lands next" ring is under the body, not touching the head (0, -4)
  assert.ok(open.marker.length > 0);
  for (const [x, y] of open.marker) assert.ok(Math.abs(x) + Math.abs(y + 4) > 2 && y > 2, `marker ${x},${y} clear of the head`);
  assert.equal(butterflyPixels("open").marker.length, 0);
  // three frames, about 5 Hz, held open in a glide
  const frames = new Set(Array.from({ length: 8 }, (_, i) => flapFrame(i * 50, false)));
  assert.deepEqual([...frames].sort(), ["half", "open", "up"]);
  assert.equal(flapFrame(0, false), flapFrame(200, false), "one cycle in 0.2 s");
  assert.equal(flapFrame(50, true), "open");
  // hops and glides, not a sine: some 0.9 s slots flat, the rest within 3 px
  let flat = 0;
  for (let n = 0; n < 40; n++) {
    const h = butterflyHop(7, n * 900 + 450);
    if (h.dy === 0) flat++;
    assert.ok(h.dy <= 0 && h.dy >= -3);
  }
  assert.ok(flat >= 4 && flat <= 30, `${flat} glides in 40 slots`);
});

test("chat: typing until the reply or 20 s, then still thinking, then nothing (queue 73)", async () => {
  // @ts-ignore TS5097
  const { chatWait } = await import("../lib/world.ts");
  const at = (s: string) => new Date(s).getTime();
  const owner = { ts: "2026-11-02T22:10:00", from: "Owner" };
  assert.equal(chatWait([], at("2026-11-02T22:10:05")), null);
  assert.equal(chatWait([owner], at("2026-11-02T22:10:05")), "typing");
  assert.equal(chatWait([owner], at("2026-11-02T22:10:19")), "typing");
  assert.equal(chatWait([owner], at("2026-11-02T22:10:21")), "slow");
  assert.equal(chatWait([owner], at("2026-11-02T22:21:00")), null); // gave up showing it after 10 minutes
  assert.equal(chatWait([owner, { ts: "2026-11-02T22:10:04", from: "Lead Gen" }], at("2026-11-02T22:10:05")), null);
});

test("a member's HTML screen box by its width (queue 258): full from 120 px, compact from 80 px, tiny below", () => {
  assert.deepEqual(screenForm(138, 98), { form: "full", lines: 4 });
  assert.deepEqual(screenForm(95, 68), { form: "compact", lines: 3 });
  assert.deepEqual(screenForm(57, 43), { form: "tiny", lines: 2 });
  assert.deepEqual(screenForm(70, 30), { form: "tiny", lines: 1 });
});

test("ticker: the portal in local mode leads the line with the team's address (queue 294)", async () => {
  // @ts-ignore TS5097
  const { tickerText } = await import("../lib/world.ts");
  assert.match(tickerText([], null, 0, [], { url: "https://brave-otter.trycloudflare.com" }), /^Portal \(local mode\): https:\/\/brave-otter\.trycloudflare\.com   ·   Leads today 0/);
  assert.match(tickerText([], null, 0, [], { url: "" }), /^Portal \(local mode\): the tunnel is not up yet/);
  assert.doesNotMatch(tickerText([], null, 0, [], null), /Portal/);
});

test("screen feed (queue 287): the header, a resting or stuck first line, then the activity newest first", async () => {
  // @ts-ignore TS5097
  const { screenFeed } = await import("../lib/world.ts");
  const base = { name: "Lead Enricher", slug: "lead-enricher", state: { word: "working", tone: "good", why: "" }, last: null, output: { label: "lead update", today: 11 }, actionsToday: 40, refusedShare: 0.3, goal: 12, window: { allowed: 6, total: 12 }, item: "", modelAgo: "1 min ago", model: { label: "api.z.ai/glm", ts: "" } };
  const activity = [
    { hhmm: "15:31", words: "opened cibao-restaurant.com · menu page", kind: "web" },
    { hhmm: "15:30", words: "searched 'Cibao Restaurant Bronx'", kind: "search" },
    { hhmm: "15:28", words: "updated Fiesta Lounge · Phone", kind: "other" },
  ];
  const f = screenFeed({ ...base, activity } as never);
  assert.equal(f.head, "11 updates today"); // a plain count: the owner lifted the limits (11-11)
  assert.deepEqual(f.lines.map((l: { text: string; mark: string }) => [l.text, l.mark]), [
    ["15:31 opened cibao-restaurant.com · menu page", "web"],
    ["15:30 searched 'Cibao Restaurant Bronx'", "search"],
    ["15:28 updated Fiesta Lounge · Phone", ""],
  ]);
  assert.ok(!JSON.stringify(f).includes("refused") && !JSON.stringify(f).includes("ok · 30m"));
  const resting = screenFeed({ ...base, state: { word: "resting until 16:10", tone: "muted", why: "work list empty" }, activity } as never);
  assert.deepEqual(resting.lines[0], { text: "resting until 16:10 · work list empty", mark: "", state: true });
  const stuck = screenFeed({ ...base, refusedRun: 3, refusal: { words: "updated lead 'X'", reason: "the phone is not on the listing" }, activity } as never);
  assert.equal(stuck.lines[0].text, "stuck: the phone is not on the listing");
  assert.equal(stuck.lines.length, 4);
});
