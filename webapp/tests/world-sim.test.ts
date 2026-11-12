// Run: npm test. The room's replay harness (creatorCC queue 27, 2026-10-31): board snapshots go through the world's
// simulation as the page runs it (a poll every 12 s, a frame every 1/30 s) and the room's rules are checked at every
// frame. Two days: a synthetic one that forces every transition (flickers, quiet, rest, a stop and a start, more
// members than usual), and a recording of the live board (tests/fixtures/board-replay.json, 30 minutes, 12 s apart).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-ignore TS5097
import { animOf, bedOf, figures, gridDistance, newSim, obstacles as sceneObstacles, NOTICE_SPOT, placeOf, POST_SPOT, shoreSeat, simErrand, SPEED, simPoll, simStep, simWeb, TERMINAL, terminalShows, type Pt } from "../lib/world.ts";

type Snap = { at: number; cards: { slug: string; word: string }[]; stopped: string[]; web?: Record<string, { lastTs: string; domain: string }>; errands?: { slug: string; to: "post" | "notice" }[] };

const POSES = new Set(["walk", "type", "sit", "stand", "use", "stretch", "sip", "glance"]);
const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Rectangles (in tiles) nobody may walk through, written out here independently of lib/world.ts: the lake, the low
 *  walls under the screens, the post box, the notice board's and the signboard's posts, the tree trunk, the mats. A
 *  walker may enter its own mat only on the last leg straight into it, or leave it on the first leg. */
function obstacles(sim: ReturnType<typeof newSim>, n: number): { box: [number, number, number, number]; spots: Pt[] }[] {
  // the lake, then every object as drawn (lib/world obstacles(): the same footprints the walks are planned on), a
  // twentieth of a tile inside each edge, for the n places the walk was planned with
  const out: { box: [number, number, number, number]; spots: Pt[] }[] = [{ box: [-1, 4, 25, 5.05], spots: [] }];
  for (const o of sceneObstacles(n)) out.push({ box: [o.foot.x0 + 0.05, o.foot.y0 + 0.05, o.foot.x1 - 0.05, o.foot.y1 - 0.05], spots: [] });
  for (const slug of sim.beds) {
    const b = bedOf(sim, slug);
    out.push({ box: [b.x - 0.8, b.y - 0.3, b.x + 0.8, b.y + 0.4], spots: [b] });
  }
  return out;
}

function replay(snaps: Snap[], opts: { quiet?: (i: number) => boolean } = {}) {
  const sim = newSim();
  const fps = 30;
  const dt = 1 / fps;
  let t = 0;
  const prev = new Map<string, Pt>();
  const seenAnim = new Map<string, string[]>(); // the anim each poll asked for, per member
  let frames = 0;
  let walks = 0;
  const visits: { slug: string; poll: number; shows: string | null }[] = []; // each arrival at the terminal
  const errands: { slug: string; poll: number; at: Pt }[] = []; // each arrival at the post box or the notice board
  const onErrand = new Set<string>();
  const atTerminal = new Set<string>();
  const walking = new Set<string>();
  snaps.forEach((s, i) => {
    simPoll(sim, s.cards.map((c) => ({ slug: c.slug, state: { word: c.word } })), s.stopped.map((slug) => ({ slug })));
    if (s.web) simWeb(sim, s.web);
    for (const e of s.errands ?? []) simErrand(sim, e.slug, e.to);
    for (const c of s.cards) seenAnim.set(c.slug, [...(seenAnim.get(c.slug) ?? []), animOf({ word: c.word })]);
    const quiet = opts.quiet?.(i) ?? s.cards.some((c) => c.word === "quiet");
    for (let f = 0; f < 12 * fps; f++) {
      t += dt * 1000;
      simStep(sim, t, dt, { quiet, still: false });
      frames++;
      const figs = figures(sim, t, { quiet, still: false });
      const where = `poll ${i}, frame ${f}`;
      // every walk is a shortest one: its length equals a plain breadth-first search's distance on the same grid
      for (const m of sim.members.values()) {
        if (m.path.length && !walking.has(m.slug)) {
          walking.add(m.slug);
          walks++;
          const dest = m.path[m.path.length - 1];
          let len = Math.abs(m.pos.x - m.spot.x) + Math.abs(m.pos.y - m.spot.y);
          let at = m.pos;
          for (const q of m.path) {
            len += Math.abs(q.x - at.x) + Math.abs(q.y - at.y);
            at = q;
          }
          const beds = sim.beds.filter((b) => !sim.members.has(b) || b === m.slug).map((b) => bedOf(sim, b));
          const best = gridDistance(m.spot, dest, beds, m.n);
          assert.ok(Number.isFinite(best), `${where}: ${m.slug} has no path to ${JSON.stringify(dest)}`);
          assert.ok(Math.abs(len - best) < 1e-6, `${where}: ${m.slug}'s walk is ${len} tiles, the shortest is ${best}`);
        }
        if (!m.path.length) walking.delete(m.slug);
      }
      // a pose for everyone, and only a walker is off a spot
      for (const g of figs) {
        assert.ok(POSES.has(g.pose), `${where}: ${g.slug} has no pose (${g.pose})`);
        const m = sim.members.get(g.slug)!;
        if (g.pose !== "walk") {
          // its place, or the spot it last stood still on (quiet keeps it there after the terrace's layout changed)
          const spots = [placeOf(sim, g.slug).spot, m.spot, TERMINAL, POST_SPOT, NOTICE_SPOT, bedOf(sim, g.slug), ...(m.shore !== null ? [shoreSeat(m.shore)] : [])];
          assert.ok(spots.some((p) => near(p, g.pos)), `${where}: ${g.slug} stands at ${JSON.stringify(g.pos)}, not on a spot (${g.pose})`);
        }
        // no teleport: never further than a frame's walk
        const was = prev.get(g.slug);
        if (was) assert.ok(Math.abs(was.x - g.pos.x) + Math.abs(was.y - g.pos.y) <= SPEED * dt + 1e-6, `${where}: ${g.slug} jumped from ${JSON.stringify(was)} to ${JSON.stringify(g.pos)}`);
        prev.set(g.slug, { ...g.pos });
        // no walk through the lake, a wall, a post, the trunk or a mat (save the last leg into its own mat)
        if (g.pose === "walk") {
          const dest = m.path[m.path.length - 1];
          for (const o of obstacles(sim, m.n)) {
            const [x0, y0, x1, y1] = o.box;
            const inside = g.pos.x > x0 && g.pos.x < x1 && g.pos.y > y0 && g.pos.y < y1;
            const ownLastLeg = !!dest && o.spots.some((p) => near(p, dest)) && Math.abs(g.pos.x - dest.x) < 1e-6;
            const ownFirstLeg = o.spots.some((p) => near(p, m.spot)) && Math.abs(g.pos.x - m.spot.x) < 1e-6;
            assert.ok(!inside || ownLastLeg || ownFirstLeg, `${where}: ${g.slug} walks through ${JSON.stringify(o.box)} at ${JSON.stringify(g.pos)}`);
          }
        }
      }
      // a visit: a member arrives at the terminal; what its screen shows a moment later
      for (const g of figs) {
        if (g.where === "terminal" && !atTerminal.has(g.slug)) {
          atTerminal.add(g.slug);
          visits.push({ slug: g.slug, poll: i, shows: null });
        } else if (g.where !== "terminal") atTerminal.delete(g.slug);
      }
      for (const g of figs) {
        if (g.where === "errand" && !onErrand.has(g.slug)) {
          onErrand.add(g.slug);
          errands.push({ slug: g.slug, poll: i, at: { ...g.pos } });
        } else if (g.where !== "errand") onErrand.delete(g.slug);
      }
      const last = visits[visits.length - 1];
      if (last && last.shows === null && atTerminal.has(last.slug)) last.shows = terminalShows(sim);
      // never two still on one spot
      const still = figs.filter((g) => g.pose !== "walk").map((g) => `${g.pos.x},${g.pos.y}`);
      assert.equal(new Set(still).size, still.length, `${where}: two members on one spot: ${still.join(" ")}`);
    }
    for (const g of figures(sim, t, { quiet, still: false })) prev.set(g.slug, { ...g.pos });
    // debounce: a member's anim is one its card asked for in two polls in a row (or on its first poll)
    for (const m of sim.members.values()) {
      const asked = seenAnim.get(m.slug) ?? [];
      const ok = asked.length < 2 || asked.slice(0, -1).some((a, k) => a === m.anim && asked[k + 1] === m.anim) || asked[0] === m.anim;
      assert.ok(ok, `poll ${i}: ${m.slug} shows ${m.anim} after asks ${asked.join(",")}`);
    }
  });
  return { sim, frames, walks, visits, errands };
}

const W = (slug: string, word = "working") => ({ slug, word });
const SIX = ["lead-enricher", "lead-gen", "outreach-writer", "package-designer", "research-analyst", "the-ceo"];
const ASLEEP = ["desk-agent", "jobless-bot", "onion-reader", "scout"];

test("replay: a synthetic day forcing every transition keeps the room's rules at every frame", () => {
  const snaps: Snap[] = [];
  const at = (i: number) => i * 12_000;
  const base = () => SIX.map((s) => W(s));
  // walks to the terminal happen: each poll, one bot has opened something new
  const web: Record<string, { lastTs: string; domain: string }> = Object.fromEntries(SIX.map((s) => [s, { lastTs: "2026-10-31T09:00:00", domain: "start.example" }]));
  for (let i = 0; i < 12; i++) {
    const who = SIX[i % SIX.length];
    web[who] = { lastTs: `2026-10-31T09:${String(10 + i).padStart(2, "0")}:00`, domain: `site${i}.example` };
    snaps.push({ at: at(snaps.length), cards: base(), stopped: ASLEEP, web: { ...web } });
  }
  // a one-poll flicker: lead-gen "resting" for one poll only must not move it
  snaps.push({ at: at(snaps.length), cards: base().map((c) => (c.slug === "lead-gen" ? W("lead-gen", "resting until 14:40") : c)), stopped: ASLEEP });
  snaps.push({ at: at(snaps.length), cards: base(), stopped: ASLEEP });
  // two rest for real, three polls
  for (let i = 0; i < 3; i++) snaps.push({ at: at(snaps.length), cards: base().map((c) => (["lead-gen", "the-ceo"].includes(c.slug) ? W(c.slug, "resting until 14:40") : c)), stopped: ASLEEP });
  // quiet falls while someone may be walking: walks finish, no new ones
  for (let i = 0; i < 4; i++) snaps.push({ at: at(snaps.length), cards: SIX.map((s) => W(s, "quiet")), stopped: ASLEEP });
  for (let i = 0; i < 6; i++) snaps.push({ at: at(snaps.length), cards: base(), stopped: ASLEEP });
  // the owner stops the Writer (it walks to the corner), then a restart's one-poll STOP flicker on the CEO
  const noWriter = SIX.filter((s) => s !== "outreach-writer");
  for (let i = 0; i < 4; i++) snaps.push({ at: at(snaps.length), cards: noWriter.map((s) => W(s)), stopped: [...ASLEEP, "outreach-writer"] });
  snaps.push({ at: at(snaps.length), cards: noWriter.filter((s) => s !== "the-ceo").map((s) => W(s)), stopped: [...ASLEEP, "outreach-writer", "the-ceo"] });
  for (let i = 0; i < 3; i++) snaps.push({ at: at(snaps.length), cards: noWriter.map((s) => W(s)), stopped: [...ASLEEP, "outreach-writer"] });
  // the owner starts Scout: it gets up from its mat and walks to a free slot; blocked and silent states sit, not stand
  const withScout = [...noWriter, "scout"];
  for (let i = 0; i < 6; i++)
    snaps.push({
      at: at(snaps.length),
      cards: withScout.map((s) => W(s, s === "lead-gen" ? "blocked on the model provider" : s === "package-designer" ? "no heartbeat 25 min" : "working")),
      stopped: ["desk-agent", "jobless-bot", "onion-reader", "outreach-writer"],
    });
  const { sim, frames, walks } = replay(snaps);
  assert.ok(frames > 10_000);
  assert.ok(walks >= 10, `${walks} walks checked`);
  // where it ended: the Writer asleep (no member), Scout at a slot, the CEO not moved by its flicker
  assert.equal(sim.members.has("outreach-writer"), false);
  assert.ok(sim.members.has("scout"));
  assert.ok(sim.beds.includes("outreach-writer"));
  const slots = [...sim.members.values()].map((m) => m.slot);
  assert.equal(new Set(slots).size, slots.length, "one member per slot");
});

test("replay: the lead-gen flicker never left its slot; slots stay put when the card order changes", () => {
  const snaps: Snap[] = [];
  for (let i = 0; i < 3; i++) snaps.push({ at: i, cards: SIX.map((s) => W(s)), stopped: ASLEEP });
  for (let i = 0; i < 3; i++) snaps.push({ at: i, cards: [...SIX].reverse().map((s) => W(s)), stopped: ASLEEP });
  const { sim } = replay(snaps);
  SIX.forEach((s, i) => assert.equal(sim.members.get(s)!.slot, i, `${s} kept slot ${i}`));
});

test("replay: a recorded half hour of the live board keeps the room's rules at every frame", () => {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "board-replay.json");
  const snaps = JSON.parse(readFileSync(file, "utf8")) as Snap[];
  assert.ok(snaps.length >= 130, `${snaps.length} snapshots`);
  replay(snaps);
});

// ---- The WEB terminal follows real browsing (queue 33) ----
const webOf = (lastTs: Record<string, string>) => Object.fromEntries(Object.entries(lastTs).map(([slug, ts]) => [slug, { lastTs: ts, domain: `www.${slug}-directory.example` }]));

test("terminal: a bot walks there only when its latest web action is new, once, and the screen shows its domain", () => {
  const same = webOf(Object.fromEntries(SIX.map((s) => [s, "2026-10-31T09:00:00"])));
  const snaps: Snap[] = [];
  for (let i = 0; i < 4; i++) snaps.push({ at: i, cards: SIX.map((s) => W(s)), stopped: ASLEEP, web: same }); // nothing new: nobody goes
  snaps.push({ at: 4, cards: SIX.map((s) => W(s)), stopped: ASLEEP, web: { ...same, ...webOf({ "lead-gen": "2026-10-31T09:05:00" }) } });
  for (let i = 5; i < 9; i++) snaps.push({ at: i, cards: SIX.map((s) => W(s)), stopped: ASLEEP, web: { ...same, ...webOf({ "lead-gen": "2026-10-31T09:05:00" }) } });
  const { visits } = replay(snaps);
  assert.equal(visits.length, 1, JSON.stringify(visits));
  assert.equal(visits[0].slug, "lead-gen");
  assert.equal(visits[0].poll, 4);
  assert.equal(visits[0].shows, "lead-gen-…", "www. dropped, 10 characters at most");
});

test("terminal: two bots with something new in one poll: one visit, the other is dropped, not queued", () => {
  const start = webOf(Object.fromEntries(SIX.map((s) => [s, "2026-10-31T09:00:00"])));
  const both = { ...start, ...webOf({ "lead-gen": "2026-10-31T09:05:00", "the-ceo": "2026-10-31T09:05:10" }) };
  const snaps: Snap[] = [{ at: 0, cards: SIX.map((s) => W(s)), stopped: ASLEEP, web: start }];
  for (let i = 1; i < 10; i++) snaps.push({ at: i, cards: SIX.map((s) => W(s)), stopped: ASLEEP, web: both });
  const { visits } = replay(snaps);
  assert.equal(visits.length, 1, JSON.stringify(visits));
});

test("terminal: the recorded board with one web change has exactly one visit", () => {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "board-replay.json");
  const snaps = (JSON.parse(readFileSync(file, "utf8")) as Snap[]).slice(0, 40);
  const running = snaps[0].cards.map((c) => c.slug);
  const base = webOf(Object.fromEntries(running.map((s) => [s, "2026-10-31T09:00:00"])));
  const who = running[0];
  snaps.forEach((s, i) => (s.web = i < 20 ? base : { ...base, ...webOf({ [who]: "2026-10-31T09:04:00" }) }));
  const { visits } = replay(snaps);
  assert.deepEqual(visits.map((v) => [v.slug, v.poll]), [[who, 20]]);
});

// ---- The floating screens' carousel (queue 39) ----
test("carousel: a step every 8 s with a slide; hover and quiet pause it, a slide under way finishes; reduced motion swaps", async () => {
  // @ts-ignore TS5097
  const { carouselStep, carouselFrames, newCarousel, CAROUSEL, CAROUSEL_EVERY, pageCard, lookOf } = await import("../lib/world.ts");
  const o = { count: 5, paused: false, quiet: false, still: false, single: false };
  let c = newCarousel();
  const run = (ms: number, opts = o) => {
    for (let t = 0; t < ms; t += 1000 / 30) c = carouselStep(c, 1000 / 30, opts);
  };
  run(CAROUSEL_EVERY - 200);
  assert.equal(c.at, 0, "not yet");
  run(400);
  assert.equal(c.at, 1, "one step after 8 s");
  assert.ok(c.slide < 1, "sliding");
  run(1000, { ...o, paused: true });
  assert.equal(c.slide, 1, "a slide under way finishes while paused");
  run(CAROUSEL_EVERY * 2, { ...o, paused: true });
  assert.equal(c.at, 1, "hover holds it");
  run(CAROUSEL_EVERY * 2, { ...o, quiet: true });
  assert.equal(c.at, 1, "quiet holds it");
  run(CAROUSEL_EVERY + 100, { ...o, still: true });
  assert.deepEqual([c.at, c.slide], [2, 1], "reduced motion: a swap, no slide");
  // the frames at rest: left, centre and right show the pages around the centre one, the centre largest
  const frames = carouselFrames({ at: 2, clock: 0, slide: 1 }, 5);
  assert.deepEqual(frames.map((f: { index: number; role: string }) => [f.index, f.role]).sort(), [[1, "left"], [2, "centre"], [3, "right"]]);
  assert.deepEqual(frames.find((f: { role: string }) => f.role === "centre")!.rect, CAROUSEL.centre);
  // under 1024 px: one screen
  assert.deepEqual(carouselFrames({ at: 2, clock: 0, slide: 1 }, 5, true).map((f: { index: number }) => f.index), [2]);
  // in the sky-and-lake band, above the shore path and the people
  for (const r of Object.values(CAROUSEL) as { y: number; h: number }[]) assert.ok(r.y >= 0 && r.y + r.h + 8 <= 82);
  // the fallback card
  assert.deepEqual(pageCard({ slug: "scout", name: "Scout", domain: "www.apidog.com", title: "Top 8 Free AI APIs", ago: "3 min ago" }), {
    domain: "apidog.com",
    title: "Top 8 Free AI APIs",
    color: lookOf("scout").shirt,
    caption: "Scout · apidog.com · 3 min ago",
  });
});

// ---- What really happened, animated (queue 40) ----
test("actions: each kind its animation, a refusal a puff; nothing for an unknown kind", async () => {
  // @ts-ignore TS5097
  const { actAnim } = await import("../lib/world.ts");
  const a = (type: string, verdict = "allowed") => actAnim({ type, verdict });
  assert.deepEqual(
    ["search", "open", "follow", "read", "note", "summarize", "lead", "update_lead", "publish_package", "propose", "task", "update_task", "message", "wait"].map((t) => a(t)),
    ["binoculars", "tablet", "tablet", "tablet", "laptop", "laptop", "pin", "pin", "flag", "propose", "clipboard", "clipboard", "plane", null],
  );
  assert.equal(a("open", "refused"), "puff");
  assert.equal(a("open", "failed"), null);
});

test("actions: one animation per bot per poll (a backlog never queues), nothing on the first poll", async () => {
  // @ts-ignore TS5097
  const { newActs } = await import("../lib/world.ts");
  const seen = new Map<string, number>();
  const card = (slug: string, id: number) => ({ slug, act: { id, type: "open", verdict: "allowed" } });
  assert.deepEqual(newActs(seen, [card("lead-gen", 10), card("scout", 5)]), [], "first poll: nothing replays");
  // lead-gen did three things since: one animation, its newest
  assert.deepEqual(newActs(seen, [card("lead-gen", 13), card("scout", 5)]).map((x: { slug: string; act: { id: number } }) => [x.slug, x.act.id]), [["lead-gen", 13]]);
  assert.deepEqual(newActs(seen, [card("lead-gen", 13), card("scout", 5)]), [], "nothing new: nothing plays");
});

test("trouble: three refusals in a row is stuck until an allowed action", async () => {
  // @ts-ignore TS5097
  const { isStuck } = await import("../lib/world.ts");
  assert.equal(isStuck({ refusedRun: 2 }), false);
  assert.equal(isStuck({ refusedRun: 3 }), true);
  assert.equal(isStuck({ refusedRun: 0 }), false, "released by an allowed action (the run starts again)");
});

test("paper planes go to a colleague's screen, the notice board for everyone, the sky for the owner", async () => {
  // @ts-ignore TS5097
  const { planeTo } = await import("../lib/world.ts");
  const cards = [{ slug: "lead-gen", name: "Lead Gen" }, { slug: "the-ceo", name: "The CEO" }];
  assert.deepEqual(planeTo("The CEO", cards), { kind: "member", slug: "the-ceo" });
  assert.deepEqual(planeTo("everyone", cards), { kind: "board" });
  assert.deepEqual(planeTo("Owner", cards), { kind: "sky" });
  assert.deepEqual(planeTo("someone we do not know", cards), { kind: "board" });
});

test("the bird: a Validator flag newer than the last poll's brings its note; rain while the main provider is out", async () => {
  // @ts-ignore TS5097
  const { newFlags, weatherOf } = await import("../lib/world.ts");
  const seen = new Map();
  assert.deepEqual(newFlags(seen, { "lead-gen": { newest: "2026-10-31T10:00:00", text: "a" } }), []);
  assert.deepEqual(newFlags(seen, { "lead-gen": { newest: "2026-10-31T10:30:00", text: "Lead score missing" } }), [{ slug: "lead-gen", text: "Lead score missing" }]);
  assert.deepEqual(newFlags(seen, { "lead-gen": { newest: "2026-10-31T10:30:00", text: "Lead score missing" } }), []);
  assert.equal(weatherOf({ outage: true }), "rain");
  assert.equal(weatherOf({ outage: false }), "clear");
});

test("outputs walk: the Writer's draft to the post box and back, a proposal to the notice board; one at a time, never queued", async () => {
  // @ts-ignore TS5097
  const { errandOf } = await import("../lib/world.ts");
  assert.equal(errandOf("outreach-writer", { type: "update_lead", verdict: "allowed" }), "post");
  assert.equal(errandOf("lead-gen", { type: "lead", verdict: "allowed" }), "post");
  assert.equal(errandOf("the-ceo", { type: "propose", verdict: "allowed" }), "notice");
  assert.equal(errandOf("lead-gen", { type: "lead", verdict: "refused" }), null);
  assert.equal(errandOf("lead-enricher", { type: "update_lead", verdict: "allowed" }), null);
  const snaps: Snap[] = [];
  const cards = SIX.map((s) => W(s));
  snaps.push({ at: 0, cards, stopped: ASLEEP });
  snaps.push({ at: 1, cards, stopped: ASLEEP, errands: [{ slug: "outreach-writer", to: "post" }, { slug: "lead-gen", to: "post" }, { slug: "the-ceo", to: "notice" }] });
  for (let i = 2; i < 8; i++) snaps.push({ at: i, cards, stopped: ASLEEP });
  const { errands, sim } = replay(snaps);
  // one of the two takes the post box, the other's (at the same moment) is dropped; the CEO pins its note
  const posted = errands.filter((e: { at: Pt }) => e.at.x === POST_SPOT.x && e.at.y === POST_SPOT.y);
  assert.equal(posted.length, 1, JSON.stringify(errands));
  assert.ok(["outreach-writer", "lead-gen"].includes(posted[0].slug));
  assert.equal(errands.length, 2);
  assert.deepEqual(errands.find((e: { slug: string }) => e.slug === "the-ceo")!.at, NOTICE_SPOT);
  for (const m of sim.members.values()) assert.ok(m.trip === "none", `${m.slug} is back at its place`);
});

// queue 47 part 4: pranks as filler; queue 57: eligibility per member, no family-wide quiet window
test("pranks: resting, idle or between-steps members, one at a time, one every 2 minutes in the room, a member once in 5 minutes", async () => {
  // @ts-ignore TS5097
  const { newPranks, prankStep, PRANK_EVERY_MS, PRANK_REST_MS, PRANK_SETTLE_MS } = await import("../lib/world.ts");
  const at = (x: number, y: number) => ({ x, y });
  const crew = [
    { slug: "lead-gen", anim: "resting" as const, pos: at(2.5, 5.25), atShore: true },
    { slug: "scout", anim: "resting" as const, pos: at(4.25, 5.25), atShore: true },
    { slug: "outreach-writer", anim: "idle" as const, pos: at(5, 5.25), atShore: false },
    { slug: "package-designer", anim: "idle" as const, pos: at(6, 5.25), atShore: false },
    { slug: "the-ceo", anim: "working" as const, pos: at(6, 9.75), atShore: false },
    { slug: "research-analyst", anim: "lost" as const, pos: at(8, 9.75), atShore: false },
  ];
  const o = { real: [] as string[], quiet: false, still: false, rain: false, day: true };
  const pr = newPranks(4747, 0);
  assert.equal(prankStep(pr, PRANK_SETTLE_MS - 1, crew, o), null, "the page settles first");
  // other members acting every few seconds do not hold it back (the old family-wide 90 s window)
  const g = prankStep(pr, PRANK_SETTLE_MS, crew, { ...o, real: ["the-ceo", "research-analyst"] });
  assert.ok(g, "a gag 20 s after the page opens, while others act");
  assert.ok(g.actors.every((s: string) => ["lead-gen", "scout", "outreach-writer", "package-designer"].includes(s)), "never a working or stalled member");
  assert.ok(g.until - g.start >= 4000 && g.until - g.start <= 6000, "4-6 s");
  assert.equal(prankStep(pr, g.start + 1000, crew, { ...o, real: ["the-ceo"] }), g, "another member's action: it plays on");
  assert.equal(prankStep(pr, g.until, crew, o), null, "over");
  assert.equal(prankStep(pr, g.start + PRANK_EVERY_MS - 1, crew, o), null, "one every 2 minutes in the room");
  const g2 = prankStep(pr, g.start + PRANK_EVERY_MS, crew, o);
  assert.ok(g2, "the next after 2 minutes");
  assert.ok(!g2.actors.some((s: string) => g.actors.includes(s)), "not the same members within 5 minutes");
  // an actor's own action ends it at once
  assert.equal(prankStep(pr, g2.start + 500, crew, { ...o, real: [g2.actors[0]] }), null);
  // a third within 5 minutes only from members that have not played; once everyone has, nothing until a rest is over
  const played = new Set([...g.actors, ...g2.actors]);
  const g4 = prankStep(pr, g2.start + PRANK_EVERY_MS, crew, o);
  if (g4) assert.ok(!g4.actors.some((s: string) => played.has(s)), "only members that have not played");
  const quietCrew = crew.filter((m) => played.has(m.slug));
  const pr3 = { ...pr, gag: null, lastGag: -Infinity, recent: Object.fromEntries([...played].map((s) => [s, g2.start])) };
  assert.equal(prankStep(pr3, g2.start + PRANK_REST_MS - 1, quietCrew, o), null, "everyone left played under 5 minutes ago");
  assert.ok(prankStep(pr3, g2.start + PRANK_REST_MS, quietCrew, o), "after 5 minutes they may play again");
  // an actor that goes back to work ends it too
  const pr2 = newPranks(1, 0);
  const g3 = prankStep(pr2, PRANK_SETTLE_MS, crew, o);
  assert.ok(g3);
  const working = crew.map((m) => (m.slug === g3.actors[0] ? { ...m, anim: "working" as const } : m));
  assert.equal(prankStep(pr2, PRANK_SETTLE_MS + 100, working, o), null);
  // nobody eligible: nothing; quiet or reduced motion: nothing
  assert.equal(prankStep(newPranks(1, 0), PRANK_SETTLE_MS, crew.map((m) => ({ ...m, anim: "working" as const })), o), null);
  assert.equal(prankStep(newPranks(1, 0), PRANK_SETTLE_MS, crew, { ...o, quiet: true }), null);
  assert.equal(prankStep(newPranks(1, 0), PRANK_SETTLE_MS, crew, { ...o, still: true }), null);
});

test("pranks: a seeded choice (the same seed, the same gags); the umbrella only for the Onion Reader on a dry day", async () => {
  // @ts-ignore TS5097
  const { newPranks, prankStep, PRANK_SETTLE_MS, PRANK_REST_MS, gagFigure, boatOut } = await import("../lib/world.ts");
  const crew = [
    { slug: "onion-reader", anim: "resting" as const, pos: { x: 2.5, y: 5.25 }, atShore: true },
    { slug: "scout", anim: "idle" as const, pos: { x: 4.25, y: 5.25 }, atShore: false },
  ];
  const o = { real: [] as string[], quiet: false, still: false, rain: false, day: true };
  const run = (seed: number, opts = o) => {
    const pr = newPranks(seed, 0);
    return Array.from({ length: 12 }, (_, i) => prankStep(pr, PRANK_SETTLE_MS + i * PRANK_REST_MS, crew, opts)).map((g: { kind: string; actors: string[] } | null) => g && `${g.kind}:${g.actors.join("+")}`);
  };
  assert.deepEqual(run(4747), run(4747));
  assert.notDeepEqual(run(4747), run(9));
  const kinds = new Set(run(4747).concat(run(9), run(23)).map((x: string | null) => x?.split(":")[0]));
  assert.ok(kinds.has("umbrella") && kinds.size >= 4, [...kinds].join(","));
  assert.ok(!run(4747, { ...o, rain: true }).some((x: string | null) => x?.startsWith("umbrella")), "not in the rain");
  // what a gag does to the figures
  const boat = { kind: "boat" as const, actors: ["onion-reader"], start: 0, until: 5000, skips: 3 };
  assert.equal(gagFigure(boat, "onion-reader", 2500).hide, true);
  assert.equal(gagFigure(boat, "onion-reader", 5000).hide, false, "back on the shore");
  assert.ok(boatOut(boat, 2500) > 60 && boatOut(boat, 0) === 0 && boatOut(boat, 5000) === 0);
  const ball = { kind: "paperball" as const, actors: ["scout", "onion-reader"], start: 0, until: 5000, skips: 0 };
  assert.equal(gagFigure(ball, "onion-reader", 3000).dx, -4, "the target dodges");
  assert.equal(gagFigure(ball, "scout", 3000).dx, 0);
  assert.equal(gagFigure(ball, "the-ceo", 3000).dx, 0);
});

test("pranks in the replay: members acting every 60-90 s, a gag every 2-4 minutes, the same gags on a second run (queue 57)", async () => {
  // @ts-ignore TS5097
  const { newSim, simPoll, simStep, newPranks, prankStep, betweenSteps } = await import("../lib/world.ts");
  // five members working on 60-90 s cycles (a normal afternoon) and the CEO resting; a real action every cycle each
  const cycles: Record<string, number> = { "lead-gen": 90, "lead-enricher": 60, "outreach-writer": 75, "research-analyst": 90, "package-designer": 80 };
  const base = new Date(2026, 9, 31, 15, 0, 0).getTime();
  const stamp = (ms: number) => {
    const d = new Date(ms);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };
  const play = () => {
    const sim = newSim();
    const cards = [...Object.keys(cycles), "the-ceo"].map((slug) => ({ slug, state: { word: slug === "the-ceo" ? "resting until 16:30" : "working" } }));
    const pr = newPranks(4747, 0);
    const seen: string[] = [];
    const starts: number[] = [];
    for (let t = 0; t <= 900_000; t += 100) {
      if (t % 12_000 === 0) simPoll(sim, cards, []);
      simStep(sim, t, 0.1, { quiet: false, still: false });
      const acted = Object.entries(cycles).filter(([slug, c], i) => (t + i * 7000) % (c * 1000) === 0).map(([slug]) => slug);
      const ms = [...sim.members.values()].map((m: { slug: string; anim: string; pos: { x: number; y: number }; shore: number | null; path: unknown[] }) => {
        const c = cycles[m.slug];
        const i = Object.keys(cycles).indexOf(m.slug);
        const last = c ? t - ((t + i * 7000) % (c * 1000)) : 0;
        return { slug: m.slug, anim: m.anim, pos: m.pos, atShore: m.shore !== null && !m.path.length, between: !!c && betweenSteps(stamp(base + last), c, base + t) };
      });
      const g = prankStep(pr, t, ms as never, { real: acted, quiet: false, still: false, rain: false, day: true });
      if (g && !starts.includes(g.start)) {
        starts.push(g.start);
        seen.push(`${g.start}:${g.kind}:${g.actors.join("+")}`);
      }
    }
    return { seen, starts };
  };
  const once = play();
  assert.ok(once.starts.length >= 4, `at least four gags in 15 minutes: ${once.seen.join(" ")}`);
  const gaps = once.starts.slice(1).map((s, i) => s - once.starts[i]);
  assert.ok(gaps.every((g) => g >= 120_000), "never closer than 2 minutes");
  assert.ok(gaps.reduce((a, b) => a + b, 0) / gaps.length <= 240_000, `about one every 2-4 minutes: ${gaps.join(", ")}`);
  assert.deepEqual(play(), once, "the same gags on a second run");
});

test("pranks between steps: a working member whose last action is 30 s old and next step 25 s away may play; a sleeper only as the dozer (queues 52, 57)", async () => {
  // @ts-ignore TS5097
  const { betweenSteps, betweenWhy, newPranks, prankStep, PRANK_SETTLE_MS } = await import("../lib/world.ts");
  const now = new Date(2026, 9, 31, 15, 40, 0).getTime();
  const ago = (s: number) => {
    const d = new Date(now - s * 1000);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };
  assert.equal(betweenSteps(ago(50), 120, now), true, "50 s since, 70 s to go");
  assert.equal(betweenSteps(ago(25), 120, now), false, "too soon after its action");
  assert.equal(betweenSteps(ago(100), 120, now), false, "its next step is under 25 s away");
  assert.equal(betweenSteps(ago(40), 90, now), true, "a 90 s cycle qualifies: 40 s since, 50 s to go");
  assert.equal(betweenSteps(ago(30), 50, now), false, "a 50 s cycle never leaves 25 s after 30 s");
  assert.equal(betweenWhy(ago(30), 50, now), "cycle too short (50 s < 55 s)");
  assert.equal(betweenWhy(ago(10), 90, now), "not between steps: acted 10 s ago");
  assert.equal(betweenWhy(ago(70), 90, now), "not between steps: next step in 20 s");
  assert.equal(betweenWhy(ago(40), 90, now), null);
  assert.equal(betweenSteps(null, 120, now), false);
  assert.equal(betweenSteps(ago(50), null, now), false);
  const o = { real: [] as string[], quiet: false, still: false, rain: false, day: true };
  const at = (x: number, y: number) => ({ x, y });
  const two = [
    { slug: "lead-gen", anim: "working" as const, pos: at(5, 9.75), atShore: false, between: true },
    { slug: "the-ceo", anim: "working" as const, pos: at(10, 9.75), atShore: false, between: true },
  ];
  const g = prankStep(newPranks(4747, 0), PRANK_SETTLE_MS, two, o);
  assert.ok(g && g.actors.length === 2, "two members between steps play");
  assert.equal(prankStep(newPranks(4747, 0), PRANK_SETTLE_MS, two.map((m) => ({ ...m, between: false })), o), null, "busy members do not");
  // a resting member alone pokes the sleeper on the nearest mat; a sleeper never starts one
  const bed = [{ slug: "scout", pos: at(21.75, 8) }];
  const resting = [{ slug: "lead-gen", anim: "resting" as const, pos: at(17, 9.75), atShore: false }];
  const pr = newPranks(1, 0);
  const poke = prankStep(pr, PRANK_SETTLE_MS, resting, o, bed);
  assert.deepEqual(poke && [poke.kind, ...poke.actors], ["poke", "lead-gen", "scout"]);
  assert.equal(prankStep(newPranks(1, 0), PRANK_SETTLE_MS, [], o, bed), null);
  assert.equal(prankStep(newPranks(1, 0), PRANK_SETTLE_MS, [{ ...two[0] }], o, bed), null, "only a resting member pokes a sleeper");
});

// The range stays visible (after queue 77): asleep, one small pane in the clear sky right of the third peak; awake,
// three panes as before.
test("floating screens: idle layout clears the peaks, hover restores three", async () => {
  // @ts-ignore TS5097
  const { carouselFrames, CAROUSEL_IDLE, IDLE_ALPHA, CAROUSEL } = await import("../lib/world.ts");
  const c = { at: 3, clock: 0, slide: 1 };
  const idle = carouselFrames(c, 5, false, 0);
  assert.equal(idle.length, 1);
  assert.equal(idle[0].index, 3); // the rotation goes on in the small pane
  assert.deepEqual(idle[0].rect, CAROUSEL_IDLE);
  assert.equal(idle[0].alpha, IDLE_ALPHA);
  const r = idle[0].rect;
  // clear of the twin-peaked summit (x 150-167) and the third peak (x 186-198), and above the range's top there (y 22)
  assert.ok(r.x > 200 && r.x + r.w < 245, "between the third peak and the range IV");
  assert.ok(r.y + r.h <= 22, "above the skyline");
  assert.ok(Math.abs(r.w - CAROUSEL.centre.w / 3) < 1, "a third of the centre pane");
  const awake = carouselFrames(c, 5, false, 1);
  assert.deepEqual(awake.map((f: { role: string }) => f.role).sort(), ["centre", "left", "right"]);
  const half = carouselFrames(c, 5, false, 0.5);
  const centre = half.find((f: { role: string }) => f.role === "centre")!;
  assert.ok(centre.rect.w > CAROUSEL_IDLE.w && centre.rect.w < CAROUSEL.centre.w, "waking grows the pane");
});
