// Run: npm test. The room's replay harness (2026-10-31): board snapshots go through the world's
// simulation as the page runs it (a poll every 12 s, a frame every 1/30 s) and the room's rules are checked at every
// frame, over a synthetic day that forces every transition (flickers, quiet, rest, a stop and a start, more
// members than usual).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore TS5097
import { animOf, bedOf, desk, figures, gridDistance, MAX_DESKS, newSim, SPEED, simPoll, simStep, sofaSeat, TERMINAL, type Pt } from "../lib/world.ts";

type Snap = { at: number; cards: { slug: string; word: string }[]; stopped: string[] };

const POSES = new Set(["walk", "type", "sit", "stand", "use", "stretch", "sip", "glance"]);
const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Rectangles (in tiles) nobody may walk through: the desks, the terminal cabinet, the sofa, the mats. A walker may
 *  enter only its own destination's rectangle on the last leg straight into it, or leave its own on the first leg. */
function obstacles(sim: ReturnType<typeof newSim>): { box: [number, number, number, number]; spots: Pt[] }[] {
  const out: { box: [number, number, number, number]; spots: Pt[] }[] = [];
  for (let i = 0; i < MAX_DESKS; i++) {
    const d = desk(i).desk;
    out.push({ box: [d.x + 0.05, d.y - 0.2, d.x + 2.7, d.y + 0.9], spots: [] });
  }
  out.push({ box: [22.05, 4.1, 22.95, 6], spots: [] });
  out.push({ box: [0.75, 10.45, 6.25, 11.6], spots: Array.from({ length: 5 }, (_, i) => sofaSeat(i)) });
  for (const slug of sim.beds) {
    const b = bedOf(sim, slug);
    out.push({ box: [b.x - 0.8, b.y - 0.3, b.x + 0.8, b.y + 0.4], spots: [b] });
  }
  return out;
}

function replay(snaps: Snap[], opts: { quiet?: (i: number) => boolean } = {}) {
  let r = 7;
  const sim = newSim(() => ((r = (r * 9301 + 49297) % 233280) / 233280)); // a seeded "random", so runs repeat
  const fps = 30;
  const dt = 1 / fps;
  let t = 0;
  const prev = new Map<string, Pt>();
  const seenAnim = new Map<string, string[]>(); // the anim each poll asked for, per member
  let frames = 0;
  let walks = 0;
  const walking = new Set<string>();
  snaps.forEach((s, i) => {
    simPoll(sim, s.cards.map((c) => ({ slug: c.slug, state: { word: c.word } })), s.stopped.map((slug) => ({ slug })), t);
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
          const best = gridDistance(m.spot, dest, beds);
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
          const spots = [desk(m.desk).seat, TERMINAL, bedOf(sim, g.slug), ...(m.sofa !== null ? [sofaSeat(m.sofa)] : [])];
          assert.ok(spots.some((p) => near(p, g.pos)), `${where}: ${g.slug} stands at ${JSON.stringify(g.pos)}, not on a spot (${g.pose})`);
        }
        // no teleport: never further than a frame's walk
        const was = prev.get(g.slug);
        if (was) assert.ok(Math.abs(was.x - g.pos.x) + Math.abs(was.y - g.pos.y) <= SPEED * dt + 1e-6, `${where}: ${g.slug} jumped from ${JSON.stringify(was)} to ${JSON.stringify(g.pos)}`);
        prev.set(g.slug, { ...g.pos });
        // no walk through a desk, the terminal, the sofa or a mat (save the last leg into its own spot)
        if (g.pose === "walk") {
          const dest = m.path[m.path.length - 1];
          for (const o of obstacles(sim)) {
            const [x0, y0, x1, y1] = o.box;
            const inside = g.pos.x > x0 && g.pos.x < x1 && g.pos.y > y0 && g.pos.y < y1;
            const ownLastLeg = !!dest && o.spots.some((p) => near(p, dest)) && Math.abs(g.pos.x - dest.x) < 1e-6;
            const ownFirstLeg = o.spots.some((p) => near(p, m.spot)) && Math.abs(g.pos.x - m.spot.x) < 1e-6;
            assert.ok(!inside || ownLastLeg || ownFirstLeg, `${where}: ${g.slug} walks through ${JSON.stringify(o.box)} at ${JSON.stringify(g.pos)}`);
          }
        }
      }
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
  return { sim, frames, walks };
}

const W = (slug: string, word = "working") => ({ slug, word });
const SIX = ["lead-enricher", "lead-gen", "outreach-writer", "package-designer", "research-analyst", "the-ceo"];
const ASLEEP = ["desk-agent", "jobless-bot", "onion-reader", "scout"];

test("replay: a synthetic day forcing every transition keeps the room's rules at every frame", () => {
  const snaps: Snap[] = [];
  const at = (i: number) => i * 12_000;
  const base = () => SIX.map((s) => W(s));
  for (let i = 0; i < 12; i++) snaps.push({ at: at(snaps.length), cards: base(), stopped: ASLEEP }); // walks to the terminal happen
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
  // the owner starts Scout: it gets up from its mat and walks to a free desk; blocked and silent states sit, not stand
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
  // where it ended: the Writer asleep (no member), Scout at a desk, the CEO not moved by its flicker
  assert.equal(sim.members.has("outreach-writer"), false);
  assert.ok(sim.members.has("scout"));
  assert.ok(sim.beds.includes("outreach-writer"));
  const desks = [...sim.members.values()].map((m) => m.desk);
  assert.equal(new Set(desks).size, desks.length, "one member per desk");
});

test("replay: the lead-gen flicker never left its desk; desks stay put when the card order changes", () => {
  const snaps: Snap[] = [];
  for (let i = 0; i < 3; i++) snaps.push({ at: i, cards: SIX.map((s) => W(s)), stopped: ASLEEP });
  for (let i = 0; i < 3; i++) snaps.push({ at: i, cards: [...SIX].reverse().map((s) => W(s)), stopped: ASLEEP });
  const { sim } = replay(snaps);
  SIX.forEach((s, i) => assert.equal(sim.members.get(s)!.desk, i, `${s} kept desk ${i}`));
});
