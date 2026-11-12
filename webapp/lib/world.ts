// The home page's office world (creatorCC queue 17, 2026-10-30, owner: "a 2D world, the agents as pixel characters,
// with a window that shows what each one is working on"). The pure parts, kept apart from the canvas so the tests run
// with Node's own runner: what each state looks like, where everything stands in the room, the paths between, the
// dialogue box's lines, the speech bubbles a poll brings, and each member's look (the same everywhere it is drawn).
// All data comes from /api/board (lib/board-read.ts); nothing here reads a file.
import type { BotCard, Screen, WebEvent } from "./board";

export const TILE = 16;
export const COLS = 24; // five screens a row
export const ROWS = 16; // the lakeside (queue 37): mountains and the lake at the back, two rows of five screens on the terrace

/** What a character does for a state word. */
type Anim = "working" | "idle" | "resting" | "quiet" | "blocked" | "lost";

export function animOf(state: { word: string }): Anim {
  const w = state.word;
  if (w === "working") return "working";
  if (w.startsWith("resting")) return "resting";
  if (w === "quiet") return "quiet";
  if (w === "stalled" || w.startsWith("no heartbeat")) return "lost";
  if (w === "restarting") return "idle"; // stays at its place while restart-bot.sh runs
  if (w.startsWith("blocked")) return "blocked";
  return "idle"; // paused, waiting for a task
}

/** A thundercloud over the head: the model provider is failing for this member. */
export const stormOf = (state: { word: string }) => /model provider/.test(state.word);

/** "resting until 14:40" -> "14:40", for the resting member's dimmed screen. */
export const restUntil = (state: { word: string }) => /until (\d{2}:\d{2})/.exec(state.word)?.[1] ?? "";

export type Pt = { x: number; y: number }; // tiles
export const MAX_DESKS = 10; // a place on the terrace for every family member

// The scene (owner, 10-31: "I do not need the desk and UI that is only taking up space. I want bigger screens ... maybe
// nature with mountains"): a mountain range over a lake at the back (rows
// 0-5), a stone path along the shore (rows 5-6.5), and a terrace with two rows of five big screens, each on two posts
// over a low stone wall with its member standing (or sitting on the wall) in front of it. One big tree at the right edge
// shades the members the owner stopped; the post box (mailbox), the notice board (bulletin board) and the WEB
// signboard by the pier stand along the shore path.
export const SCREEN = { w: 64, h: 44 }; // px: four tiles wide, about seven times the old office monitor
const WALL_W = 44; // px: the low wall, centred under the screen; the gaps between walls are paths
const TERRACE_W = 21; // tiles left of the tree that the screens share
const SLOT_ROWS = [6.75, 11.5]; // the two rows' screen tops, tiles
const quarter = (x: number) => Math.round(x * 4) / 4;

/** Where n members' screens stand (queue 38: the grid fits the family, 8 is 4 + 4, 9 is 5 + 4, 10 is 5 + 5): rows of
 *  ceil(n / 2) (one row up to three), each centred left of the tree and spread out when it is short. Place k: its
 *  screen's top-left tile and the spot its member stands on, centred under the screen in front of the low wall. */
export function layout(n: number): { screen: Pt; spot: Pt }[] {
  const count = Math.max(1, Math.min(MAX_DESKS, n));
  const perRow = count <= 3 ? count : Math.ceil(count / 2);
  const out: { screen: Pt; spot: Pt }[] = [];
  for (let row = 0; row * perRow < count; row++) {
    const inRow = Math.min(perRow, count - row * perRow);
    const pitch = Math.floor(Math.min(5.25, (TERRACE_W + 0.25) / inRow) * 4) / 4;
    const width = inRow * pitch - (pitch - SCREEN.w / TILE);
    const x0 = quarter((TERRACE_W - width) / 2);
    for (let k = 0; k < inRow; k++) {
      const x = x0 + k * pitch;
      const y = SLOT_ROWS[row];
      out.push({ screen: { x, y }, spot: { x: x + 1.5, y: y + 3 } });
    }
  }
  return out;
}
/** Place i of a full family of ten. */
export const slot = (i: number) => layout(MAX_DESKS)[i];
/** The low wall behind place i of n, in tiles (centred under its screen). */
export const wallOf = (i: number, n: number = MAX_DESKS) => {
  const { screen, spot } = layout(n)[i];
  const x0 = screen.x + (SCREEN.w - WALL_W) / 2 / TILE;
  return { x0: x0 - 0.05, y0: spot.y - 0.6, x1: x0 + WALL_W / TILE + 0.05, y1: spot.y - 0.1, w: WALL_W };
};

// The WEB signboard stands by the pier on the shore; its visitor stands one tile left of it, on the shore path.
export const TERMINAL: Pt = { x: 17.75, y: 5.5 };
/** Where a member stands to drop a letter in the post box, and to pin a note on the notice board (queue 40). */
export const POST_SPOT: Pt = { x: 1.25, y: 5.5 };
export const NOTICE_SPOT: Pt = { x: 14.5, y: 5.5 }; // queue 45: on the shore path in front of the board, clear of the screens
/** A count on a badge (the mailbox's drafts, the terminal's pages opened today): 999+ past 999. */
export const badgeText = (n: number) => (n > 999 ? "999+" : String(n));
/** The terminal's hover line: today's three web counts across the family. */
export const webTitle = (t: { opens: number; searches: number; refused: number }) =>
  `${t.opens} page${t.opens === 1 ? "" : "s"} opened, ${t.searches} search${t.searches === 1 ? "" : "es"}, ${t.refused} refused today`;
/** The WEB signboard on screen, in room pixels, with its badge above: clicked, it opens the Web list. */
export const TERMINAL_BOX = { x: 18 * TILE, y: 3.25 * TILE, w: 2 * TILE, h: 2.5 * TILE };
/** Shore place i: where a resting member sits at the water's edge (five places, between the post box and the notice
 *  board). */
export const shoreSeat = (i: number): Pt => ({ x: 2.5 + (i % 5) * 1.75, y: 5.25 });
/** Mat i under the tree at the right edge, mat and name inside the scene: five down its shade, then along the front
 *  edge leftwards. */
export function bedSpot(i: number): Pt {
  if (i < 5) return { x: 21.75, y: 8 + i * 1.5 };
  return { x: 21.75 - (i - 4) * 2, y: 15.5 };
}
export const BULLETIN = { x: 13.5, y: 3.75, w: 3, h: 1.75 }; // the notice board on the shore, tiles
export const MAILBOX = { x: 0, y: 4, w: 1, h: 1.75 }; // the red post box at the start of the path, tiles
export const TREE_TRUNK = { x0: 22.4, y0: 6.0, x1: 23.6, y1: 7.4 };
/** The WEB signboard's board and the pier, in room px (world-draw draws them here). */
export const SIGNBOARD = { x: 18 * TILE + 4, y: 3.5 * TILE };
export const PIER = { x: 318, y: 58, w: 16, h: 24 };

// What stands on the ground (queue 45; owner, 10-31: "characters are passing through objects like screens, looks
// buggy"). Each object as it is drawn, in room px, and its footprint: the walker positions (tiles, the figure's top-left;
// its feet are one tile lower, its body about 12 px wide around x + 8 px) at which the figure would overlap the object
// with its feet inside the object's height. Those are blocked for walking, so a figure is never drawn through an
// object: whatever it overlaps, it stands wholly in front of (feet below the object's bottom: drawn after it) or wholly
// behind. The routing grid and the drawing read this one list.
export type Obstacle = { name: string; px: { x: number; y: number; w: number; h: number }; foot: { x0: number; y0: number; x1: number; y1: number } };
const FIG_HALF = 6;
const footOf = (px: { x: number; y: number; w: number; h: number }, base = 0) => ({
  x0: (px.x - 8 - FIG_HALF) / TILE,
  y0: px.y / TILE - 1,
  x1: (px.x + px.w - 8 + FIG_HALF) / TILE,
  y1: (px.y + px.h + base) / TILE - 1,
});
/** A screen place as drawn, in room px: the screen with its frame, its two posts down to the wall, and the low wall
 *  with its shadow (world-view draws the screen at `screen` + 1 and the wall at `wall`). */
export function placeDrawn(place: { screen: Pt; spot: Pt }) {
  const px = place.screen.x * TILE;
  const py = place.screen.y * TILE;
  const feetY = (place.spot.y + 1) * TILE;
  return {
    screen: { x: px - 1, y: py - 1, w: SCREEN.w + 2, h: SCREEN.h + 2 },
    posts: { x: px + 6, y: py + SCREEN.h, w: SCREEN.w - 12, h: 8 },
    wall: { x: px + (SCREEN.w - WALL_W) / 2, y: feetY - 14, w: WALL_W, h: 10 },
    feetY,
  };
}
const SHORE_BASE = 10; // px of path in front of a shore object's foot where nobody stands on it
/** Everything a walker must not pass through, for n members' screens. */
export function obstacles(n: number = MAX_DESKS): Obstacle[] {
  const out: Obstacle[] = [];
  const all = layout(n);
  all.forEach((place, i) => {
    const d = placeDrawn(place);
    const px = { x: d.screen.x, y: d.screen.y, w: d.screen.w, h: d.wall.y + d.wall.h - d.screen.y };
    out.push({ name: `screen ${i}`, px, foot: footOf(px) });
  });
  const shore = (name: string, px: Obstacle["px"], base = SHORE_BASE) => out.push({ name, px, foot: footOf(px, base) });
  shore("post box", { x: MAILBOX.x * TILE + 2, y: MAILBOX.y * TILE + 2, w: 16, h: 28 });
  shore("notice board post", { x: BULLETIN.x * TILE + 4, y: BULLETIN.y * TILE + 22, w: 3, h: 10 });
  shore("notice board post", { x: (BULLETIN.x + BULLETIN.w) * TILE - 7, y: BULLETIN.y * TILE + 22, w: 3, h: 10 });
  shore("signboard post", { x: SIGNBOARD.x + 11, y: SIGNBOARD.y + 16, w: 3, h: 18 });
  shore("pier", PIER);
  const tx = TREE_TRUNK.x0 * TILE;
  shore("tree trunk", { x: tx + 3, y: 92, w: 12, h: TREE_TRUNK.y1 * TILE - 92 }, 4);
  shore("stopped plank", { x: tx - 6, y: 104, w: 30, h: 8 }, 4);
  return out;
}
/** Depth: a figure, a screen and a wall are drawn in the order of these keys (room px), so a figure is behind a screen
 *  only while its feet are above the screen's bottom edge, and in front of every wall it stands at or below. */
export const figureKey = (pos: Pt) => (pos.y + 1) * TILE;
export const screenKey = (place: { screen: Pt }) => place.screen.y * TILE + SCREEN.h;
export const wallKey = (place: { spot: Pt }) => (place.spot.y + 1) * TILE - 6;

// Walks are shortest paths on a quarter-tile grid (owner, 10-31: "characters are not taking the shortest path").
// Blocked: the lake, every obstacle's footprint (above) and the mats. A walker may enter its own mat only straight down
// its column from above. Among the shortest paths the one with the fewest turns wins, so walks keep to the paths: the
// shore path, the gaps between screens, the stone walk between the rows and the front edge.
const STEP = 0.25;
const GX = COLS * 4; // x: 0 .. 23.75
const GY0 = 5; // y: 5 .. 15.75, from the shore down
const GY = 44;
type Box = { x0: number; y0: number; x1: number; y1: number; spots: Pt[] };

function boxes(beds: Pt[], n: number): Box[] {
  const out: Box[] = [{ x0: -1, y0: -1, x1: COLS + 1, y1: 5.1, spots: [] }]; // the lake
  for (const o of obstacles(n)) out.push({ ...o.foot, spots: [] });
  for (const b of beds) out.push({ x0: b.x - 0.85, y0: b.y - 0.35, x1: b.x + 0.85, y1: b.y + 0.45, spots: [b] });
  return out;
}

const key = (i: number, j: number) => j * GX + i;
const cellOf = (p: Pt) => ({ i: Math.round(p.x / STEP), j: Math.round((p.y - GY0) / STEP) });
const ptOf = (i: number, j: number): Pt => ({ x: i * STEP, y: GY0 + j * STEP });

/** Whether a walker may stand at `p` at all (no obstacle, mat or water under it): the grid's blocked set, for the tests. */
export function freeAt(p: Pt, beds: Pt[] = [], n: number = MAX_DESKS): boolean {
  const c = cellOf(p);
  return walkable({ x: -9, y: -9 }, { x: -9, y: -9 }, beds, n)(c.i, c.j);
}

/** Which cells a walk from `from` to `to` may use: free floor, plus its own start and end spots' columns. */
function walkable(from: Pt, to: Pt, beds: Pt[], n: number): (i: number, j: number) => boolean {
  const bs = boxes(beds, n);
  const own = (p: Pt, b: Box) => b.spots.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
  const ownMat = (p: Pt) => [from, to].some((q) => beds.some((b) => Math.abs(b.x - q.x) < 1e-6 && Math.abs(b.y - q.y) < 1e-6) && Math.abs(p.x - q.x) < 1e-6 && p.y <= q.y + 1e-6);
  return (i, j) => {
    if (i < 0 || j < 0 || i >= GX || j >= GY) return false;
    const p = ptOf(i, j);
    // feet stay inside the scene (queue 50: nothing spills into the video strip under it), save the last steps into a
    // mat on the front edge
    if (p.y > ROWS - 1 + 1e-9 && !ownMat(p)) return false;
    for (const b of bs) {
      if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) {
        // its own mat is reached from above only (its head's side)
        const mine = (own(from, b) && Math.abs(p.x - from.x) < 1e-6 && p.y <= from.y + 1e-6) || (own(to, b) && Math.abs(p.x - to.x) < 1e-6 && p.y <= to.y + 1e-6);
        if (!mine) return false;
      }
    }
    return true;
  };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The length (in tiles) of the shortest walk, by a plain breadth-first search: the harness's independent check. */
export function gridDistance(from: Pt, to: Pt, beds: Pt[] = [], n: number = MAX_DESKS): number {
  const ok = walkable(from, to, beds, n);
  const s = cellOf(from);
  const g = cellOf(to);
  const dist = new Map<number, number>([[key(s.i, s.j), 0]]);
  const q = [s];
  while (q.length) {
    const c = q.shift()!;
    const d = dist.get(key(c.i, c.j))!;
    if (c.i === g.i && c.j === g.j) return d * STEP;
    for (const [di, dj] of DIRS) {
      const n = { i: c.i + di, j: c.j + dj };
      if (!ok(n.i, n.j) || dist.has(key(n.i, n.j))) continue;
      dist.set(key(n.i, n.j), d + 1);
      q.push(n);
    }
  }
  return Infinity;
}

/** The shortest walk between two spots (fewest turns among equals), as the corners it turns at, ending on `to`. */
/** `n`: how many members' screens stand on the terrace (their walls block the way). */
export function route(from: Pt, to: Pt, beds: Pt[] = [], n: number = MAX_DESKS): Pt[] {
  if (Math.abs(from.x - to.x) < 1e-6 && Math.abs(from.y - to.y) < 1e-6) return [];
  const ok = walkable(from, to, beds, n);
  const s = cellOf(from);
  const g = cellOf(to);
  // Dijkstra over (cell, heading): a step costs 1000, a turn 1, so length comes first and turns break ties
  const best = new Map<number, number>();
  const prev = new Map<number, number>();
  const sk = (i: number, j: number, d: number) => (j * GX + i) * 4 + d;
  const heap: [number, number, number, number][] = []; // cost, i, j, dir
  const push = (e: [number, number, number, number]) => {
    heap.push(e);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 4; d++) {
    best.set(sk(s.i, s.j, d), 0);
    push([0, s.i, s.j, d]);
  }
  let end = -1;
  while (heap.length) {
    const [cost, i, j, d] = pop();
    const here = sk(i, j, d);
    if (cost > (best.get(here) ?? Infinity)) continue;
    if (i === g.i && j === g.j) {
      end = here;
      break;
    }
    DIRS.forEach(([di, dj], nd) => {
      const ni = i + di;
      const nj = j + dj;
      if (!ok(ni, nj)) return;
      const c = cost + 1000 + (nd === d ? 0 : 1);
      const k = sk(ni, nj, nd);
      if (c < (best.get(k) ?? Infinity)) {
        best.set(k, c);
        prev.set(k, here);
        push([c, ni, nj, nd]);
      }
    });
  }
  if (end < 0) return [{ ...to }]; // nothing free: step straight (never expected; the harness would flag it)
  const cells: Pt[] = [];
  for (let k: number | undefined = end; k !== undefined; k = prev.get(k)) {
    const c = k >> 2;
    cells.push(ptOf(c % GX, Math.floor(c / GX)));
  }
  cells.reverse();
  // keep the corners only
  const out: Pt[] = [];
  for (let n = 1; n < cells.length; n++) {
    const a = cells[n - 1];
    const b = cells[n];
    const c = cells[n + 1];
    if (!c || (b.x - a.x !== c.x - b.x) || (b.y - a.y !== c.y - b.y)) out.push(b);
  }
  out[out.length - 1] = { ...to };
  return out;
}

export type Accessory = "crown" | "cap" | "glasses" | "headphones" | "bow" | "beanie" | "tie" | "scarf" | "visor" | "flower";
export type Look = { shirt: string; hair: string; skin: string; accessory: Accessory };

// One look per family member, the same on the world, the list and the dialogue box. Shirts are distinct hues; the
// accessory tells two members apart even without colour.
const LOOKS: Record<string, Look> = {
  "the-ceo": { shirt: "#3b4a9e", hair: "#2b1d14", skin: "#e8b58f", accessory: "crown" },
  "lead-gen": { shirt: "#2f8f5b", hair: "#6b3e1f", skin: "#c98b62", accessory: "cap" },
  "lead-enricher": { shirt: "#1f8fa6", hair: "#1c1c1c", skin: "#f1c7a3", accessory: "glasses" },
  "outreach-writer": { shirt: "#b8457a", hair: "#a0522d", skin: "#e0a77f", accessory: "bow" },
  "package-designer": { shirt: "#8a5cc7", hair: "#e3c16f", skin: "#f3d0b4", accessory: "beanie" },
  "research-analyst": { shirt: "#c4862b", hair: "#3a2a20", skin: "#b07a55", accessory: "headphones" },
  "desk-agent": { shirt: "#5d6b78", hair: "#4a4a4a", skin: "#d9a47e", accessory: "tie" },
  "jobless-bot": { shirt: "#7a8f3a", hair: "#2a2a2a", skin: "#8d5a3b", accessory: "scarf" },
  "onion-reader": { shirt: "#9e5a3b", hair: "#d8d0c0", skin: "#efc9a8", accessory: "visor" },
  scout: { shirt: "#3d7f86", hair: "#7a4b2a", skin: "#caa07c", accessory: "flower" },
};
const SPARE: Look[] = [
  { shirt: "#4f6fb3", hair: "#3b2a1a", skin: "#e2b08b", accessory: "cap" },
  { shirt: "#a8553f", hair: "#1e1e1e", skin: "#c48a64", accessory: "glasses" },
  { shirt: "#5a9a7a", hair: "#8a5a32", skin: "#f0c8a6", accessory: "beanie" },
  { shirt: "#946bb0", hair: "#2a2018", skin: "#a8724c", accessory: "headphones" },
];

export function lookOf(slug: string): Look {
  if (LOOKS[slug]) return LOOKS[slug];
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}

/** The dialogue box for a member: its lines, top to bottom. Questions and interests come before the last action (owner,
 *  10-30, as on the bot page); the model line names the provider its last call used, never the configured fallback. */
export function dialogue(c: BotCard, o: { now?: boolean } = {}): { title: string; lines: string[]; href: string } {
  // `now`: the world's dialogue shows the state, what it is doing and today's counts in its own block above (queue 221),
  // so the list leaves those two lines out
  const lines: string[] = [];
  if (!o.now) lines.push(c.state.why ? `${capital(c.state.word)} · ${c.state.why}` : capital(c.state.word));
  if (c.on) lines.push(`${c.onKind === "thought" ? "Thinking" : c.onKind === "question" ? "Question" : "Working on"}: ${c.on.replace(" · step ", ", step ")}`);
  if (c.questions?.length) lines.push(`Asking: ${c.questions.join(" · ")}`);
  if (c.interests?.length) lines.push(`Interested in: ${c.interests.join(", ")}`);
  lines.push(c.last ? `Last: ${c.last.words}, ${c.last.ago}` : "Last: no accepted action yet");
  const out = c.output ? `${c.output.today} ${c.output.label}${c.output.today === 1 ? "" : "s"} today` : `${c.actionsToday} actions today`;
  if (!o.now) lines.push(c.refusedShare === null ? out : `${out} · refused ${Math.round(c.refusedShare * 100)}%`);
  if (c.model) lines.push(`Model: ${c.model.label} (last call ${c.model.ts.slice(11, 16)})`);
  const gear = gearWords(c.slug); // what it carries (queue 52): "Lead Gen leaA · binoculars"
  return { title: `${c.name} ${c.handle}`.trim() + (gear ? ` · ${gear}` : ""), lines, href: `/work-plan#${c.slug}` };
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A thought over a member for 3 s after its action (queue 40; the speech bubble of its last words before). */
export type Bubble = { slug: string; text: string; until: number };

/** The "7 days" tab of a member's text box (creatorCC queue 18: the Family review's numbers): actions and refused share,
 *  accepted outputs by type, crashes, and how long since its last output of its own kind ("late" when overdue). */
type Week7Like = {
  actions: number;
  refused: number;
  refusedShare: number;
  outputs: Record<string, number>;
  crashes: number;
  lastCrash: string | null;
  lastOutput: { label: string; ago: string; late: boolean } | null;
};
const OUT_WORD: Record<string, string> = { lead: "leads", update_lead: "lead updates", note: "notes", task: "tasks", message: "messages", publish_package: "packages published", package: "packages", say: "chat replies", ask: "questions asked" };

export function week7Lines(w: Week7Like | undefined): string[] {
  if (!w) return ["The 7-day numbers are still being read."];
  const out = Object.entries(w.outputs)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} ${OUT_WORD[t] ?? t.replace(/_/g, " ")}`);
  return [
    `${w.actions} actions · ${w.refused} refused (${Math.round(w.refusedShare * 100)}%)`,
    out.length ? `Accepted: ${out.join(", ")}` : "Accepted: nothing yet",
    w.crashes ? `Crashes: ${w.crashes}${w.lastCrash ? ` (last ${w.lastCrash})` : ""}` : "Crashes: none",
    w.lastOutput ? `Last ${w.lastOutput.label}: ${w.lastOutput.ago}${w.lastOutput.late ? " (overdue)" : ""}` : "",
  ].filter(Boolean);
}

/** The downtime line over the room, for the last 24 hours: when the Mac was off and when the family was quiet. */
export function downtimeLine(d: { off: Span[]; quiet: Span[] } | null, now: number): string {
  if (!d) return "";
  if (!d.off.length && !d.quiet.length) return "Last 24 h: the Mac was on and nobody was quiet.";
  // queue 49: each span dated and in the past tense once it is over ("Yesterday 15:20-22:12 quiet while Steam ran (6 h
  // 51 min)"); the present tense only for a quiet still open now. Every bot logs the same quiet: one line per span.
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const today = localDay(now);
  const yesterday = localDay(now - 86_400_000);
  const day = (ts: string) => (ts.slice(0, 10) === today ? "Today" : ts.slice(0, 10) === yesterday ? "Yesterday" : ts.slice(5, 10));
  const parts: string[] = [];
  const seen = new Set<string>();
  const once = (kind: string, s: Span) => {
    const k = `${kind} ${s.from.slice(0, 16)} ${s.to.slice(0, 16)}`;
    return seen.has(k) ? false : (seen.add(k), true);
  };
  for (const s of [...d.off].sort((a, b) => a.from.localeCompare(b.from))) {
    if (!once("off", s)) continue;
    parts.push(`Mac off ${day(s.from)} ${s.from.slice(11, 16)}-${s.to.slice(11, 16)} (${hm(s.minutes)})${s.note === "no clean shutdown logged" ? " (no clean shutdown)" : ""}`);
  }
  for (const s of [...d.quiet].sort((a, b) => a.from.localeCompare(b.from))) {
    if (!once("quiet", s)) continue;
    const open = / \(still quiet\)$/.test(s.note);
    const why = quietWhy(s.note.replace(/ \(still quiet\)$/, ""), open);
    parts.push(open ? `quiet since ${s.from.slice(11, 16)}${why} (${hm(s.minutes)} so far)` : `${day(s.from)} ${s.from.slice(11, 16)}-${s.to.slice(11, 16)} quiet${why} (${hm(s.minutes)})`);
  }
  return `Last 24 h: ${parts.join(" · ")}.`;
}
type Span = { from: string; to: string; minutes: number; note: string };
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** The engine's quiet reason as " while <App> ran" (or "is running" while still quiet): "steam_osx is running" ->
 *  Steam, "Steam is in front" -> was in front. Any other reason in brackets. */
function quietWhy(reason: string, open: boolean): string {
  const r = reason.trim();
  if (!r) return "";
  const m = /^(.+?) is (running|in front)$/i.exec(r);
  if (!m) return ` (${r})`;
  const app = m[1].replace(/[_-]?(osx|mac|macos|app)$/i, "").replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
  if (m[2].toLowerCase() === "running") return open ? ` while ${app} is running` : ` while ${app} ran`;
  return open ? ` while ${app} is in front` : ` while ${app} was in front`;
}

/** What a member's big screen on the terrace shows (queue 37; was the desk monitor of queue 21): line 1 its name and
 *  state word in the state's tone; lines 2-3 what it is doing now, from its last accepted action (the domain and the
 *  page's title, "search: <query>", or the document it wrote); line 4, small, today's output and refused share. Resting
 *  or quiet: dimmed, the state word says until when. Blocked: a red screen with why; a model failure's first seconds:
 *  static; silent or idle: dim with why. `compact` (under 1024 px): the first two lines only. */
export type ScreenMode = "web" | "search" | "doc" | "dark" | "alert" | "static" | "dim";
export type BigScreen = {
  mode: ScreenMode;
  name: string;
  word: string;
  tone: string;
  /** What it is doing: one or two lines (queue 37). */
  lines: string[];
  foot: string;
  share: number | null;
  /** The owner's four lines (creatorCC queue 233): output against the goal, the item it is on, the provider and its
   *  freshness, the last 30 minutes' allowed actions. Empty for a card without those facts (tests, older data). */
  four: string[];
  /** The orange square before line 2: it names a page ("web") or a search. */
  mark: "web" | "search" | "";
};

// What a working member is doing when its last action is neither a page, a search nor a document (queue 38: The CEO
// read "working" over "rested", the words of its last rest).
const DOING: Record<string, string> = { plan: "updating its plan", update_plan: "updating its plan", journal: "writing its journal", ask: "asking a question", wait: "waiting a moment" };

/** Today's output and refused share, in full words: "4 updates · 30% refused" (queue 221: no "ref."; it reads in the
 *  member's dialogue, at normal size, over its own meter). */
export function screenFoot(c: Pick<BotCard, "output" | "actionsToday" | "refusedShare">): string {
  const n = c.output ? c.output.today : c.actionsToday;
  const word = c.output ? (c.output.label.split(" ").pop() ?? c.output.label) : "action";
  const out = `${n} ${word}${n === 1 ? "" : "s"}`;
  return c.refusedShare === null ? out : `${out} · ${Math.round(c.refusedShare * 100)}% refused`;
}

type ScreenCard = Pick<BotCard, "name" | "state" | "last" | "output" | "actionsToday" | "refusedShare"> &
  Partial<Pick<BotCard, "item" | "modelAgo" | "window" | "goal" | "model" | "questions" | "slug">> & { on?: string };

/** "4 h ago" -> "4h", "3 min ago" -> "3m", "40 s ago" -> "40s", "2 d ago" -> "2d" (the screens' short age). */
export const shortAgo = (s: string) => s.replace(/^(\d+) (s|min|h|d) ago$/, (_, n: string, u: string) => `${n}${u === "min" ? "m" : u}`);

/** "api.z.ai/glm-4.5-flash" -> "z.ai"; "gemini/flash" -> "gemini". */
export const providerOf = (label: string) => (label.split("/")[0] ?? "").replace(/^api\./, "");

export function screenFor(c: ScreenCard, o: { compact?: boolean; noise?: boolean } = {}): BigScreen {
  const anim = animOf(c.state);
  const base = { name: c.name, word: c.state.word, tone: c.state.tone, share: o.compact ? null : c.refusedShare };
  // a working bot retrying a failed call says so on line 4, small and muted (queue 49)
  const foot = o.compact ? "" : c.state.word === "working" && c.state.why ? c.state.why : screenFoot(c);
  const cut = (lines: string[]) => (o.compact ? lines.filter(Boolean).slice(0, 1) : lines.filter(Boolean).slice(0, 2));
  const pick = (): Omit<BigScreen, "four" | "mark"> => {
    if (o.noise) return { ...base, mode: "static", lines: [], foot };
    // resting (queue 42: "resting un…" was cut): the header says "resting", line 2 until when, line 3 why
    if (anim === "resting") return { ...base, word: "resting", mode: "dark", lines: cut([restUntil(c.state) ? `until ${restUntil(c.state)}` : "", c.state.why]), foot };
    if (anim === "quiet") return { ...base, mode: "dark", lines: cut([c.state.why]), foot };
    if (anim === "blocked") return { ...base, mode: "alert", lines: cut([c.state.why]), foot };
    if (anim === "lost" || anim === "idle" || !c.last) return { ...base, mode: "dim", lines: cut([c.state.why]), foot };
    const sc: Screen = c.last.screen ?? { kind: "other", domain: "", title: c.last.words };
    if (sc.kind === "web") return { ...base, mode: "web", lines: cut([sc.domain.replace(/^www\./, "") || "reading…", sc.title]), foot };
    if (sc.kind === "search") return { ...base, mode: "search", lines: cut([`search: ${sc.title}`]), foot };
    if (sc.kind === "doc") return { ...base, mode: "doc", lines: cut([c.last.words]), foot };
    // anything else (a plan update, a rest that just ended, a journal): what it is doing now, and its plan step if any
    const type = sc.title.replace(/ /g, "_");
    return { ...base, mode: "doc", lines: cut([DOING[type] ?? "thinking…", c.on ?? ""]), foot };
  };
  const out = pick();
  // the owner's four lines (queue 233), one each, data-true: nothing shown that the card does not carry
  const n = c.output ? c.output.today : c.actionsToday;
  const noun = c.output ? (c.output.label.split(" ").pop() ?? c.output.label) : "action";
  // the screens' short wording (queue 243: 13-17 characters fit a line): "11 updates today", a plain count (the owner,
  // 11-11: the limits are lifted, so no "/goal"); "z.ai · 4h"; "9/13 ok · 30m"
  const made = madeToday(n, noun);
  const working = out.mode === "web" || out.mode === "search" || out.mode === "doc";
  // line 2: the item it is on; else the Analyst's question; else its page or search; resting or stuck: until when, why
  const item = working ? c.item || (c.slug === "research-analyst" ? (c.questions?.[0] ?? "") : "") : "";
  const second = item || out.lines.join(" · ");
  const mark = item ? "" : out.mode === "web" ? "web" : out.mode === "search" ? "search" : "";
  const fresh = c.model ? `${providerOf(c.model.label)}${c.modelAgo ? ` · ${shortAgo(c.modelAgo)}` : ""}` : "";
  // 17 characters fit a line at 14 px: the window's allowed/all in the shortest true words
  const win = c.window && c.window.total ? `${c.window.allowed}/${c.window.total} ok · 30m` : c.window ? "no actions · 30m" : "";
  const four = c.window === undefined ? [] : [made, second, fresh, win];
  // with the four lines the footer is only the refused share (line 1 has the count), over its meter
  const footer = four.length && out.foot === screenFoot(c) ? (c.refusedShare === null ? "" : `${Math.round(c.refusedShare * 100)}% refused`) : out.foot;
  return { ...out, foot: footer, four, mark };
}

/** Today's output as a plain count: "148 drafts today", "1 action today" (no "/goal" since the owner lifted the limits). */
const madeToday = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"} today`;

/** The member's screen (creatorCC queue 287, the owner: "about the work, not the guards"): the header line (today's
 *  output against the goal, as line 1 was), then a feed of what it is doing, newest first: a first line "resting until
 *  HH:MM · why" (any state other than working) or "stuck: <the last refusal's reason>" (three refusals in a row), then
 *  its newest allowed actions with their times; page and search lines carry the orange square. The refused share, the
 *  30-minute pace and the last model call moved to the dialogue's Now block. */
export type FeedLine = { text: string; mark: "web" | "search" | "" ; state?: boolean };
export function screenFeed(
  c: ScreenCard & { activity?: { hhmm: string; words: string; kind: "web" | "search" | "other" }[]; refusal?: { words: string; reason: string } | null; refusedRun?: number },
): { head: string; lines: FeedLine[] } {
  const sc = screenFor(c);
  const n = c.output ? c.output.today : c.actionsToday;
  const noun = c.output ? (c.output.label.split(" ").pop() ?? c.output.label) : "action";
  const head = sc.four[0] ?? madeToday(n, noun);
  const lines: FeedLine[] = [];
  if (c.state.word !== "working") lines.push({ text: [c.state.word, c.state.why].filter(Boolean).join(" · "), mark: "", state: true });
  else if (isStuck(c)) lines.push({ text: `stuck: ${c.refusal?.reason || c.refusal?.words || "three refusals in a row"}`, mark: "", state: true });
  for (const a of c.activity ?? []) lines.push({ text: `${a.hhmm} ${a.words}`.trim(), mark: a.kind === "other" ? "" : a.kind });
  // a card without the feed (older data, tests): what the screen said before, page or search with its square
  if (!lines.length) lines.push({ text: sc.lines.join(" · ") || c.state.why || "", mark: sc.mark });
  return { head, lines };
}

// ---- Polish (creatorCC queue 22, commit 2) ----

export type DayPhase = { phase: "night" | "dawn" | "day" | "dusk"; sky: string; glow: string; dark: number; lamps: boolean };

/** The scene by the Mac's clock: the sky, how dark the scene is (an overlay's alpha), and whether the lamps
 *  are on (from 18:00 until 7:00). */
export function dayPhase(hour: number, minute = 0): DayPhase {
  const t = hour + minute / 60;
  const lamps = t >= 18 || t < 7;
  if (t >= 6 && t < 7.5) return { phase: "dawn", sky: "#f6c99a", glow: "#fff1d6", dark: 0.12, lamps };
  if (t >= 7.5 && t < 17) return { phase: "day", sky: "#a9dcef", glow: "#e6f6fc", dark: 0, lamps };
  if (t >= 17 && t < 19.5) return { phase: "dusk", sky: "#f2a46b", glow: "#ffd9b0", dark: 0.14, lamps };
  return { phase: "night", sky: "#1d2547", glow: "#3b4a8a", dark: 0.3, lamps };
}

type Prompt =
  | { kind: "proposal"; id: string; title: string; lines: string[] }
  | { kind: "decision"; id: string; title: string; lines: string[]; options: string[]; link: { label: string; href: string } | null }
  | { kind: "done"; id: "done"; title: string; lines: string[] };

type BoardPrompts = {
  proposals: { id: string; bot: string; change: string; reason: string; metric: string; expected: string; validator: string }[];
  decisions: { id: string; since: string; text: string; options: string[]; link: { label: string; href: string } | null }[];
};

/** The bulletin board's prompts, one at a time: each open CEO proposal (Yes = approve, No = decline), then each open
 *  owner's decision with its own options, Done and Later (queue 32), each until answered in this visit; "done" when
 *  nothing is pinned. */
export function nextPrompt(b: BoardPrompts, answered: ReadonlySet<string>): Prompt {
  const p = b.proposals.find((x) => !answered.has(x.id));
  if (p) {
    const lines = [p.change];
    if (p.reason) lines.push(`Why: ${p.reason}`);
    if (p.metric || p.expected) lines.push(`Measure: ${p.metric || "—"}${p.expected ? `, expected ${p.expected}` : ""}`);
    if (p.validator) lines.push(`Validator: ${p.validator}`);
    lines.push("Approve it?");
    return { kind: "proposal", id: p.id, title: `The CEO proposes, for ${p.bot}`, lines };
  }
  const left = b.decisions.filter((x) => !answered.has(x.id));
  const d = left[0];
  if (d)
    return {
      kind: "decision",
      id: d.id,
      title: `Decision waiting for you${left.length > 1 ? ` (1 of ${left.length})` : ""}${d.since ? ` · since ${d.since.slice(5, 10)}` : ""}`,
      lines: [d.text],
      options: d.options,
      link: d.link,
    };
  return { kind: "done", id: "done", title: "Bulletin board", lines: ["Nothing pinned for you right now."] };
}

/** The POST body for a Yes or No on a proposal: the same call as the proposals box. */
export const answerBody = (id: string, yes: boolean, note: string) => ({ id, action: yes ? "approve" : "decline", note: note.trim().slice(0, 300) });

type Idle = "stretch" | "sip" | "glance" | null;
const IDLES: Idle[] = ["stretch", "sip", "glance"];

/** A working member's small move between keystrokes, so it never freezes: every 14 s, for 1.6 s, one of a stretch, a
 *  sip of coffee or a glance at the window, staggered by member. */
export function idleOf(slug: string, t: number): Idle {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const period = 14_000;
  const at = (t + (h % period)) % period;
  if (at > 1600) return null;
  return IDLES[Math.floor((t + (h % period)) / period + h) % IDLES.length];
}

// ---- The owner's controls (creatorCC queue 23): what the text box asks before it acts ----
export type Action = "pause" | "resume" | "stop" | "start" | "bringback";
export type PauseFor = "30m" | "2h" | "tomorrow";

/** The question the box asks first, and the button words (Pokémon style: Yes / No). */
export function confirmText(action: Action, name: string, choice?: PauseFor): string {
  if (action === "pause") return `Pause ${name} ${choice === "30m" ? "for 30 minutes" : choice === "2h" ? "for 2 hours" : "until tomorrow morning"}?`;
  if (action === "resume") return `Let ${name} get back to work now?`;
  if (action === "stop") return `Send ${name} home? It stops until you start it again.`;
  if (action === "bringback") return `Bring ${name} back from retirement? Its launch agents are recreated and it starts.`;
  return `Wake ${name} and bring it back to its screen?`;
}


// ---- The member panel (creatorCC queues 24, 25): on desktop right of the room, on a phone under it; no pop-ups ----
export type PanelTab = "info" | "screen" | "feed" | "chat";
export type Panel = { open: boolean; tab: PanelTab };
type PanelEvent = "member" | "screen" | "terminal" | "next" | "close" | "expand";

/** A click picks the tab only when the panel is closed: a member opens it on Info, its screen on Screen. With the
 *  panel open, a click on another member or screen changes only the agent and keeps the tab (owner, 10-31: clicking one
 *  character after another must not keep flipping tabs). The WEB terminal opens the panel on the family's web list, a
 *  view of its own with no agent, and leaves the member tab alone: the next member click comes back on it. Close
 *  collapses the panel to a thin strip; the strip expands it again. */
export function panelNext(p: Panel, ev: PanelEvent): Panel {
  if (ev === "terminal") return { ...p, open: true };
  if (ev === "close") return { ...p, open: false };
  if (p.open || ev === "next" || ev === "expand") return { ...p, open: true };
  return { open: true, tab: ev === "screen" ? "screen" : "info" };
}

/** The panel's last tab, remembered in this browser so a reload comes back on it. */
const TAB_KEY = "world-panel-tab";
const TABS: PanelTab[] = ["info", "screen", "feed", "chat"];
export function savedTab(): PanelTab {
  try {
    const t = localStorage.getItem(TAB_KEY) as PanelTab | null;
    return t && TABS.includes(t) ? t : "info";
  } catch {
    return "info";
  }
}
export function saveTab(t: PanelTab) {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* not remembered */
  }
}

// ---- The room's simulation (creatorCC queue 27, 2026-10-31 overnight) ----
// The characters' state machine as it runs, kept apart from the canvas so a recorded day can be replayed through it:
//   poll (every 12 s, simPoll): each bot is "run" (a card) or "stop" (asleep under the tree). A change counts only when
//     two polls in a row agree, so one flicker in the data never flips the scene. Its animation (animOf of its state
//     word) is debounced the same way. Slots, shore places, mats and the signboard are reserved per bot and kept
//     stable: a bot keeps its slot while it exists, whatever the order of the cards.
//   step (every frame, simStep): a member at rest picks where it should be (its spot by its screen by default; a shore
//     place while resting; the WEB signboard when it has just opened or searched something (simWeb), one visitor at a
//     time; its mat when the owner stopped it) and walks there along the paths with eased speed. A walk always
//     finishes: quiet stops new walks, never one under way. Reduced motion: no walks, everyone simply is where they
//     belong.
//   figures: where each member is drawn and in which pose; there is always a pose, and only a walker is off a spot.

export const SPEED = 3; // tiles per second at full pace
const AT_TERMINAL = 3_000; // at the signboard, the post box or the notice board

type Goal = "spot" | "terminal" | "errand" | "shore" | "bed";
type Member = {
  slug: string;
  slot: number; // its place on the terrace (screen and spot)
  anim: Anim;
  pend: Anim | null;
  pos: Pt;
  spot: Pt; // the last spot it stood still on
  path: Pt[];
  walked: number; // seconds into the current walk, for easing
  facing: 1 | -1;
  trip: "none" | "go" | "there" | "back";
  web: string | null; // its latest web action's time as last polled (null: not polled yet)
  webDomain: string; // and that action's domain ("search" for a search), shown on the terminal while it stands there
  wants: Pt | null; // one trip it should make: to the signboard (a new web action), the post box or the notice board
  dest: Pt | null; // where its trip goes
  until: number;
  shore: number | null;
  leaving: boolean; // stopped by the owner: walking to its mat
  n: number; // how many places the terrace had when its current walk was planned (the walls it walks round)
};
type Seen = { kind: "run" | "stop"; pend: "run" | "stop" | null };
type Sim = { members: Map<string, Member>; seen: Map<string, Seen>; slots: (string | null)[]; shore: (string | null)[]; beds: string[]; held: Map<string, string>; polls: number };

export function newSim(): Sim {
  return { members: new Map(), seen: new Map(), slots: Array.from({ length: MAX_DESKS }, () => null), shore: Array.from({ length: 5 }, () => null), beds: [], held: new Map(), polls: 0 };
}

const eq = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
/** How many places the terrace has now: one per member holding a slot. */
const placesOf = (sim: Sim) => sim.slots.filter((s) => s !== null).length;
/** A member's place on the terrace: its slot's rank among the held slots, in the layout for that many (queue 38: the
 *  grid fits the family; when the count changes, members walk to their new places). */
export function placeOf(sim: Sim, slug: string): { screen: Pt; spot: Pt } {
  const held = sim.slots.map((s, i) => (s === null ? -1 : i)).filter((i) => i >= 0);
  const i = sim.slots.indexOf(slug);
  return layout(held.length)[Math.max(0, held.indexOf(i))];
}
export const bedOf = (sim: Sim, slug: string): Pt => bedSpot(Math.max(0, sim.beds.indexOf(slug)));

/** A new poll of the board: who runs, who sleeps, each one's state word. */
export function simPoll(sim: Sim, cards: { slug: string; state: { word: string } }[], stopped: { slug: string }[]) {
  const first = sim.polls === 0;
  sim.polls++;
  const now = new Map<string, "run" | "stop">();
  cards.slice(0, MAX_DESKS).forEach((c) => now.set(c.slug, "run"));
  stopped.forEach((s) => now.set(s.slug, "stop"));
  // presence, debounced
  for (const [slug, kind] of now) {
    const s = sim.seen.get(slug);
    if (!s || first) sim.seen.set(slug, { kind, pend: null });
    else if (s.kind === kind) s.pend = null;
    else if (s.pend === kind) sim.seen.set(slug, { kind, pend: null });
    else s.pend = kind;
  }
  for (const slug of [...sim.seen.keys()]) if (!now.has(slug)) sim.seen.delete(slug);
  // mats: stable, a new sleeper takes the next one
  sim.beds = sim.beds.filter((s) => sim.seen.get(s)?.kind === "stop" && !sim.members.get(s)?.leaving);
  for (const [slug, s] of sim.seen) if (s.kind === "stop" && !sim.beds.includes(slug)) sim.beds.push(slug);
  // members
  const born: Member[] = [];
  for (const c of cards.slice(0, MAX_DESKS)) {
    const s = sim.seen.get(c.slug);
    const anim = animOf(c.state);
    let m = sim.members.get(c.slug);
    if (s?.kind !== "run") continue; // not yet confirmed as running (one poll of a flicker)
    if (!m) {
      const free = sim.slots.indexOf(null);
      if (free < 0) continue;
      sim.slots[free] = c.slug;
      const fromBed = sim.beds.includes(c.slug) ? bedOf(sim, c.slug) : null; // started by the owner: it gets up
      const at = fromBed ?? { x: 0, y: 0 }; // a new member at work is placed below, once everyone's place is known
      m = { slug: c.slug, slot: free, anim, pend: null, pos: { ...at }, spot: { ...at }, path: [], walked: 0, facing: 1, trip: "none", web: null, webDomain: "", wants: null, dest: null, until: 0, shore: null, leaving: false, n: 0 };
      sim.members.set(c.slug, m);
      if (!fromBed) born.push(m);
      sim.beds = sim.beds.filter((b) => b !== c.slug);
      continue;
    }
    m.leaving = false;
    if (first || anim === m.anim) m.pend = null;
    else if (m.pend === anim) {
      m.anim = anim;
      m.pend = null;
    } else m.pend = anim;
  }
  for (const m of born) {
    const seat = placeOf(sim, m.slug).spot;
    m.pos = { ...seat };
    m.spot = { ...seat };
  }
  for (const m of sim.members.values()) {
    const s = sim.seen.get(m.slug);
    if (s?.kind === "stop") {
      m.leaving = true;
      if (!sim.beds.includes(m.slug)) sim.beds.push(m.slug);
    } else if (!s) drop(sim, m); // gone from the board altogether
  }
}

/** A poll of the family's web activity (/api/web perBot): a member whose latest web action is newer than at the last
 *  poll wants one trip to the terminal. The first poll of a member only notes its time. */
export function simWeb(sim: Sim, perBot: Record<string, { lastTs: string; domain: string }>) {
  for (const m of sim.members.values()) {
    const w = perBot[m.slug];
    if (!w) continue;
    if (m.web !== null && w.lastTs > m.web) m.wants ??= TERMINAL;
    m.web = w.lastTs;
    m.webDomain = w.domain;
  }
}

/** What the terminal's small screen shows: the domain of the member standing at it (10 characters at most), else null
 *  (the three bars). */
export function terminalShows(sim: Sim): string | null {
  const holder = sim.held.get(ptKey(TERMINAL));
  const m = holder ? sim.members.get(holder) : undefined;
  if (!m || m.trip !== "there" || !m.webDomain) return null;
  const d = m.webDomain.replace(/^www\./, "");
  return d.length > 10 ? `${d.slice(0, 9)}…` : d;
}

function drop(sim: Sim, m: Member) {
  sim.members.delete(m.slug);
  sim.slots = sim.slots.map((d) => (d === m.slug ? null : d));
  sim.shore = sim.shore.map((d) => (d === m.slug ? null : d));
  release(sim, m);
}

const ptKey = (p: Pt) => `${p.x},${p.y}`;
/** The place a member's trip holds is free again. */
function release(sim: Sim, m: Member) {
  for (const [k, slug] of sim.held) if (slug === m.slug) sim.held.delete(k);
}

/** A new accepted output walks somewhere (queue 40): the post box or the notice board. Dropped, like a web visit, when
 *  the member is busy, quiet holds or the place is taken; nothing queues. */
export function simErrand(sim: Sim, slug: string, to: "post" | "notice") {
  const m = sim.members.get(slug);
  if (m) m.wants ??= to === "post" ? POST_SPOT : NOTICE_SPOT;
}

/** Where a member at rest should be now, reserving the shore place or the signboard it takes. */
function goalOf(sim: Sim, m: Member, t: number, o: { quiet: boolean; still: boolean }): { pt: Pt; goal: Goal } {
  const seat = placeOf(sim, m.slug).spot;
  if (m.leaving) return { pt: bedOf(sim, m.slug), goal: "bed" };
  if (m.anim === "resting") {
    if (m.shore === null) {
      const free = sim.shore.indexOf(null);
      if (free >= 0) {
        sim.shore[free] = m.slug;
        m.shore = free;
      }
    }
    if (m.shore !== null) return { pt: shoreSeat(m.shore), goal: "shore" };
  } else if (m.shore !== null && !o.quiet) {
    // its seat is freed when it gets up, never while quiet keeps it sitting there
    sim.shore[m.shore] = null;
    m.shore = null;
  }
  if (m.shore !== null) return { pt: shoreSeat(m.shore), goal: "shore" }; // quiet: stays on the sofa it is on
  if (m.anim !== "working" || o.still) {
    if (m.dest && eq(m.pos, m.dest) && o.quiet) return { pt: m.dest, goal: eq(m.dest, TERMINAL) ? "terminal" : "errand" }; // quiet: stays where it is
    m.trip = "none";
    m.wants = null;
    m.dest = null;
    release(sim, m);
    return { pt: seat, goal: "spot" };
  }
  if (m.trip === "none" && m.wants) {
    // one trip per event, now or never: a taken place, quiet or away from its spot drops it (nothing queues)
    const to = m.wants;
    m.wants = null;
    if (!o.quiet && eq(m.pos, seat) && !sim.held.has(ptKey(to))) {
      m.trip = "go";
      m.dest = to;
      sim.held.set(ptKey(to), m.slug);
    }
  }
  if ((m.trip === "go" || m.trip === "there") && m.dest) return { pt: m.dest, goal: eq(m.dest, TERMINAL) ? "terminal" : "errand" };
  return { pt: seat, goal: "spot" };
}

/** One frame: t in ms, dt in seconds. */
export function simStep(sim: Sim, t: number, dt: number, o: { quiet: boolean; still: boolean }) {
  for (const m of [...sim.members.values()]) {
    if (!m.path.length) {
      // arrived somewhere: settle the trip, then pick the next goal
      if (m.trip === "go" && m.dest && eq(m.spot, m.dest)) {
        m.trip = "there";
        m.until = t + AT_TERMINAL;
      } else if (m.trip === "there" && t > m.until) {
        m.trip = "back";
        release(sim, m);
      } else if (m.trip === "back" && eq(m.spot, placeOf(sim, m.slug).spot)) {
        m.trip = "none";
        m.dest = null;
      }
      if (m.leaving && eq(m.spot, bedOf(sim, m.slug))) {
        drop(sim, m); // lies down on its mat: from now on a sleeper
        continue;
      }
      const g = goalOf(sim, m, t, o);
      if (m.trip === "back") g.pt = placeOf(sim, m.slug).spot;
      if (!eq(m.spot, g.pt)) {
        if (o.still) {
          m.pos = { ...g.pt };
          m.spot = { ...g.pt };
        } else if (!o.quiet || m.leaving) {
          m.n = placesOf(sim);
          m.path = route(m.spot, g.pt, sim.beds.filter((b) => !sim.members.has(b) || b === m.slug).map((b) => bedOf(sim, b)), m.n);
          m.walked = 0;
        }
      }
    }
    if (m.path.length) walk(m, dt);
  }
}

/** Along the path at an eased pace: it starts and ends gently. */
function walk(m: Member, dt: number) {
  m.walked += dt;
  let left = dt * SPEED * Math.min(1, 0.4 + m.walked * 2);
  while (left > 1e-9 && m.path.length) {
    const to = m.path[0];
    const remaining = m.path.reduce((s, p, i) => s + Math.abs(p.x - (i ? m.path[i - 1].x : m.pos.x)) + Math.abs(p.y - (i ? m.path[i - 1].y : m.pos.y)), 0);
    left = Math.min(left, dt * SPEED * Math.max(0.35, Math.min(1, remaining * 1.5)));
    const dx = to.x - m.pos.x;
    const dy = to.y - m.pos.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (Math.abs(dx) > 1e-9) m.facing = dx > 0 ? 1 : -1;
    if (dist <= left) {
      m.pos = { ...to };
      m.path.shift();
      left -= dist;
      if (!m.path.length) m.spot = { ...to };
    } else {
      if (Math.abs(dx) > 1e-9) m.pos = { x: m.pos.x + Math.sign(dx) * Math.min(Math.abs(dx), left), y: m.pos.y };
      else m.pos = { x: m.pos.x, y: m.pos.y + Math.sign(dy) * left };
      left = 0;
    }
  }
}

type FigPose = "walk" | "type" | "sit" | "stand" | "use" | "stretch" | "sip" | "glance";
type Figure = { slug: string; pos: Pt; pose: FigPose; facing: 1 | -1; where: Goal | "aisle"; anim: Anim };

/** Every member's pose: walking the paths, else on the spot it belongs to. At work it stands at its screen (now and then
 *  a stretch, a sip or a glance); otherwise it sits on the low wall in front of it. The signboard's visitor reads it
 *  standing; a resting member sits at the water's edge. */
export function figures(sim: Sim, t: number, o: { quiet: boolean; still: boolean }): Figure[] {
  const out: Figure[] = [];
  for (const m of sim.members.values()) {
    if (m.path.length) {
      out.push({ slug: m.slug, pos: m.pos, pose: "walk", facing: m.facing, where: "aisle", anim: m.anim });
      continue;
    }
    if (eq(m.pos, TERMINAL)) out.push({ slug: m.slug, pos: m.pos, pose: "use", facing: 1, where: "terminal", anim: m.anim });
    else if (m.dest && eq(m.pos, m.dest)) out.push({ slug: m.slug, pos: m.pos, pose: "use", facing: m.dest.x < 5 ? -1 : 1, where: "errand", anim: m.anim }); // the post box is on its left
    else if (m.shore !== null && eq(m.pos, shoreSeat(m.shore))) out.push({ slug: m.slug, pos: m.pos, pose: "sit", facing: 1, where: "shore", anim: m.anim });
    else if (m.leaving && eq(m.pos, bedOf(sim, m.slug))) out.push({ slug: m.slug, pos: m.pos, pose: "sit", facing: 1, where: "bed", anim: m.anim });
    else {
      const idle = m.anim === "working" && !o.quiet && !o.still ? idleOf(m.slug, t) : null;
      const pose: FigPose = m.anim === "working" && !o.quiet ? (idle ?? "use") : "sit";
      // where it stands now: after the terrace's layout changed it may not be at its new place yet (quiet holds it)
      out.push({ slug: m.slug, pos: m.pos, pose, facing: 1, where: "spot", anim: m.anim });
    }
  }
  return out;
}

// ---- The owner's private chat with one agent (queue 34) ----
/** Who has no chat: the Validator never answers one (its inbox only turns into a report note). */
export const hasChat = (slug: string) => slug !== "validator";
/** "14:05" today, "10-30 14:05" before; from the bots' local "YYYY-MM-DDTHH:MM:SS". */
export function chatTime(ts: string, now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return ts.slice(0, 10) === today ? ts.slice(11, 16) : `${ts.slice(5, 10)} ${ts.slice(11, 16)}`;
}

/** The chat as the tab draws it: the owner's lines on the right, the agent's on the left in its colour. */
export function chatRows(lines: { ts: string; from: string; text: string }[], slug: string, now: number) {
  const shirt = lookOf(slug).shirt;
  return lines.map((l) => (l.from === "Owner" ? { side: "owner" as const, time: chatTime(l.ts, now), text: l.text, color: null } : { side: "agent" as const, time: chatTime(l.ts, now), text: l.text, color: shirt }));
}

export const chatEmpty = (name: string) => `Nothing yet. Write to ${name}; it answers here, usually within seconds.`;

/** While the owner waits for a reply (queue 73): "typing" from their post until the agent's reply lands or 20 s pass,
 *  then "slow" (still thinking, the reply comes here) for up to 10 minutes; null once the agent has answered. Chat
 *  times are local ISO without a zone, as owner-chat.ts writes them. */
export const TYPING_MS = 20_000;
export function chatWait(lines: { ts: string; from: string }[], now: number): "typing" | "slow" | null {
  const last = lines[lines.length - 1];
  if (!last || last.from !== "Owner") return null;
  const waited = now - new Date(last.ts).getTime();
  if (!Number.isFinite(waited)) return null;
  if (waited < TYPING_MS) return "typing";
  return waited < 10 * 60_000 ? "slow" : null;
}

/** The agents with a reply the owner has not seen: a reply newer than the last one seen in its Chat tab (queue 35).
 *  `seen` is what this browser remembers; with nothing remembered, any reply is unread. */
export function unreadReplies(replies: Record<string, string | null> | undefined, seen: Record<string, string>): string[] {
  return Object.entries(replies ?? {})
    .filter(([slug, ts]) => !!ts && (!seen[slug] || ts > seen[slug]))
    .map(([slug]) => slug);
}

// ---- The floating screens over the lake (queue 39) ----
// The family's last valid pages (/api/web recent_pages) on three translucent screens in the sky-and-lake band, in
// perspective: the centre one largest, two smaller behind it at the sides. Every 8 s the pages move one step left with
// a short slide (reduced motion: a plain swap); hovering a screen or the family's quiet pauses it; under 1024 px a
// single screen, no rotation. Nothing floats over the people or their screens: the band ends above the shore path.
export type Rect = { x: number; y: number; w: number; h: number };
export const CAROUSEL: { left: Rect; centre: Rect; right: Rect } = {
  left: { x: 22, y: 12, w: 62, h: 36 },
  centre: { x: 92, y: 3, w: 100, h: 56 },
  right: { x: 200, y: 12, w: 62, h: 36 },
};
/** The range must stay visible (owner via creatorCC, 2026-11-02, after the mountain band): while nobody hovers the sky,
 *  only the centre page shows, a third of its width at 40 %, in the clear sky right of the third peak (x 205-239; the
 *  range there tops at y 22), clear of the twin-peaked summit (x 150-167); hovering the band (or a tap) brings all three back,
 *  for as long as the pointer stays and 3 s more. The pages keep rotating in the small pane. */
export const CAROUSEL_IDLE: Rect = { x: 205, y: 2, w: 34, h: 19 };
export const IDLE_ALPHA = 0.4;
export const WAKE_HOLD_MS = 3000;
export const SKY_BAND_BOTTOM = 82; // px: the sky and the lake; below it the shore path
export const CAROUSEL_EVERY = 8000;
const SLIDE_MS = 600;
export type Carousel = { at: number; clock: number; slide: number };
export const newCarousel = (): Carousel => ({ at: 0, clock: 0, slide: 1 });

/** One frame of the carousel: `dt` ms later. A slide under way always finishes; a new step waits while paused. */
export function carouselStep(c: Carousel, dt: number, o: { count: number; paused: boolean; quiet: boolean; still: boolean; single: boolean }): Carousel {
  const slide = Math.min(1, c.slide + dt / SLIDE_MS);
  if (o.count <= 1 || o.single || o.paused || o.quiet) return { ...c, at: o.count ? c.at % o.count : 0, slide };
  const clock = c.clock + dt;
  if (clock < CAROUSEL_EVERY) return { ...c, clock, slide };
  return { at: (c.at + 1) % o.count, clock: 0, slide: o.still ? 1 : 0 };
}

const out = (r: Rect, dx: number): Rect => ({ ...r, x: r.x + dx });
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Where each page is drawn now: index into the pages, its rectangle and alpha (0..0.8), farthest first. */
export function carouselFrames(c: Carousel, count: number, single = false, wake = 1): { index: number; rect: Rect; alpha: number; role: "left" | "centre" | "right" | "out" }[] {
  if (!count) return [];
  const w = Math.max(0, Math.min(1, wake));
  if (w < 1) {
    // asleep, or waking (w: 0..1 eased by the caller): the centre page grows out of its idle pane, the others fade in
    const awake = carouselFrames(c, count, single, 1);
    const k = w * w * (3 - 2 * w); // smoothstep
    return awake
      .map((f) =>
        f.role === "centre"
          ? { ...f, rect: { x: lerp(CAROUSEL_IDLE.x, f.rect.x, k), y: lerp(CAROUSEL_IDLE.y, f.rect.y, k), w: lerp(CAROUSEL_IDLE.w, f.rect.w, k), h: lerp(CAROUSEL_IDLE.h, f.rect.h, k) }, alpha: lerp(IDLE_ALPHA, f.alpha, k) }
          : { ...f, alpha: f.alpha * k },
      )
      .filter((f) => f.alpha > 0.01);
  }
  if (single || count === 1) return [{ index: c.at % count, rect: CAROUSEL.centre, alpha: 0.8, role: "centre" }];
  const roles: { rect: Rect; alpha: number; role: "left" | "centre" | "right" | "out" }[] = [
    { rect: out(CAROUSEL.left, -40), alpha: 0, role: "out" }, // offset -2: leaving on the left
    { rect: CAROUSEL.left, alpha: 0.8, role: "left" },
    { rect: CAROUSEL.centre, alpha: 0.8, role: "centre" },
    { rect: CAROUSEL.right, alpha: 0.8, role: "right" },
    { rect: out(CAROUSEL.right, 40), alpha: 0, role: "out" }, // offset 2: arriving from the right
  ];
  const k = 1 - (1 - c.slide) * (1 - c.slide); // ease out
  const frames = [];
  for (let off = -2; off <= 1; off++) {
    if (count === 2 && (off === -2 || off === 1)) continue; // two pages: just the centre and the left
    const to = roles[off + 2];
    const from = roles[off + 3];
    const rect = { x: lerp(from.rect.x, to.rect.x, k), y: lerp(from.rect.y, to.rect.y, k), w: lerp(from.rect.w, to.rect.w, k), h: lerp(from.rect.h, to.rect.h, k) };
    const alpha = lerp(from.alpha, to.alpha, k);
    if (alpha <= 0.01) continue;
    frames.push({ index: (((c.at + off) % count) + count) % count, rect, alpha, role: to.role });
  }
  return frames.sort((a, b) => a.rect.w - b.rect.w);
}

/** A page's fallback card when it has no picture, and its caption: the domain large, the title under it, a strip in
 *  the bot's colour; "<bot> · <domain> · <ago>". */
export function pageCard(p: { slug: string; name: string; domain: string; title: string; ago: string }) {
  const domain = p.domain.replace(/^www\./, "");
  return { domain, title: p.title, color: lookOf(p.slug).shirt, caption: `${p.name} · ${domain} · ${p.ago}` };
}

// ---- What really happened, animated (queue 40; owner, 10-31: "agents look very passive, just standing and waving") ----
// Every animation comes from a bot's real newest action (the card's act) or a board event; nothing plays that did not
// happen. One animation per bot per poll: a backlog never queues more than one.
export type ActAnim = "binoculars" | "tablet" | "laptop" | "pin" | "flag" | "clipboard" | "propose" | "plane" | "puff";
const WRITE_KINDS = new Set(["note", "summarize", "package", "draft", "entry", "journal", "revise_goal", "say", "interest", "provider"]);

/** The short animation for an action: a refusal is a red puff and a head scratch; otherwise by its kind. */
export function actAnim(act: { type: string; verdict: string }): ActAnim | null {
  if (act.verdict === "refused") return "puff";
  if (act.verdict !== "allowed") return null;
  const t = act.type;
  if (t === "search") return "binoculars";
  if (t === "open" || t === "follow" || t === "read" || t === "back") return "tablet";
  if (t === "lead" || t === "update_lead") return "pin";
  if (t === "publish_package" || t === "publish") return "flag";
  if (t === "propose") return "propose";
  if (t === "task" || t === "update_task" || t === "plan") return "clipboard";
  if (t === "message") return "plane";
  if (WRITE_KINDS.has(t)) return "laptop";
  return null;
}

/** The new actions of this poll: one per bot whose newest action is newer than the last poll's; none on a bot's first
 *  poll (nothing replays when the page opens). `seen` is updated. */
export function newActs<A extends { id: number }>(seen: Map<string, number>, cards: { slug: string; act: A | null }[]): { slug: string; act: A }[] {
  const out: { slug: string; act: A }[] = [];
  for (const c of cards) {
    if (!c.act) continue;
    const was = seen.get(c.slug);
    seen.set(c.slug, Math.max(was ?? 0, c.act.id));
    if (was !== undefined && c.act.id > was) out.push({ slug: c.slug, act: c.act });
  }
  return out;
}

/** Three refusals in a row: it sits on its wall, "stuck", until an allowed action. */
export const isStuck = (c: { refusedRun?: number }) => (c.refusedRun ?? 0) >= 3;

/** Where a message's paper plane goes: a colleague's screen, the notice board for everyone, up out of the scene for a
 *  reply to the owner. */
export function planeTo(to: string, cards: { slug: string; name: string }[]): { kind: "member"; slug: string } | { kind: "board" } | { kind: "sky" } {
  const t = to.trim().toLowerCase();
  if (t === "owner") return { kind: "sky" };
  const c = cards.find((x) => x.name.toLowerCase() === t || x.slug === t);
  return c ? { kind: "member", slug: c.slug } : { kind: "board" };
}

/** Bots with a Validator flag newer than at the last poll: a bird brings the note to their screen. `seen` is updated. */
export function newFlags(seen: Map<string, string>, flags: Record<string, { newest: string; text: string }> | undefined): { slug: string; text: string }[] {
  const out: { slug: string; text: string }[] = [];
  for (const [slug, f] of Object.entries(flags ?? {})) {
    const was = seen.get(slug);
    seen.set(slug, f.newest);
    if (was !== undefined && f.newest > was) out.push({ slug, text: f.text });
  }
  return out;
}

/** Where a new accepted output walks to: the Writer's draft and Lead Gen's lead to the post box, a proposal to the
 *  notice board; null for the rest. */
export function errandOf(slug: string, act: { type: string; verdict: string }): "post" | "notice" | null {
  if (act.verdict !== "allowed") return null;
  if (act.type === "propose") return "notice";
  if ((slug === "outreach-writer" && act.type === "update_lead") || (slug === "lead-gen" && act.type === "lead")) return "post";
  return null;
}

/** The sky over the lake: grey with light rain while the main model provider is out (the health banner's rule). */
export const weatherOf = (b: { outage?: boolean }): "rain" | "clear" => (b.outage ? "rain" : "clear");

/** Where a member's thought bubble and "stuck" tag go (queue 42: nothing drawn for a character covers a screen's text):
 *  the bubble on the path just below its feet, the tag beside it at its wall's height (both below every screen's
 *  bottom edge in its row), clamped to the scene. Pixels; `feet` is the bottom-centre of the figure. */
export function labelRects(feet: { x: number; y: number }, bubbleW: number) {
  const W = COLS * TILE;
  const Hc = ROWS * TILE;
  const bw = Math.min(bubbleW, W - 4);
  const bubble = { x: Math.max(2, Math.min(W - bw - 2, feet.x - bw / 2)), y: Math.min(Hc - 11, feet.y + 1), w: bw, h: 10 };
  const tag = { x: Math.min(W - 28, feet.x + 11), y: feet.y - 12, w: 26, h: 9 };
  return { bubble, tag };
}

/** The one-line note the Web list shows under a row's title (queue 44): the reason, only on refused, captcha and empty
 *  rows. */
export const webNote = (e: Pick<WebEvent, "mark" | "reason">): string | null => (e.mark !== "ok" && e.reason ? e.reason : null);

// ---- In the air (queue 46; owner, 10-31: "keep 3 planes flying across the world and only land one when the 4th takes
// off, so there is always a plane; and show me which plane lands or takes off next") ----
// Each of the family's newest messages is a paper plane. At most three are in the air, wandering the whole world on
// slow smooth paths (owner, 10-31 14:50: "free flight"); the oldest carries a tiny orange dot at its nose, it lands
// next. A new message takes off from its sender, touches its receiver's screen (or the notice board, or comes down from
// the sky for the owner's lines) and lifts into free flight as the newest; if that makes four, the oldest leaves at
// that moment and glides down to its own receiver, where it vanishes. On the first poll the three newest of the last
// 24 h are already up, without a take-off; fewer messages, fewer planes. Reduced motion or quiet: a new plane is simply
// up and the oldest simply gone. ("loop" below is the free-flight phase.)
export type AirMsg = { id: string; ts: string; from: string; to: string; text60: string; text120?: string };
export type Flight = { msg: AirMsg; phase: "takeoff" | "loop" | "landing"; start: number; wander: Wander };
export type Air = { flights: Flight[]; seen: Set<string>; seeded: boolean };
export const AIR_MAX = 3;
export const TAKEOFF_MS = 3600; // to the receiver (1.6 s), a touch (0.4 s), up into the loop (1.6 s)
export const LANDING_MS = 2400;
export const newAir = (): Air => ({ flights: [], seen: new Set(), seeded: false });

const localStamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const byAge = (a: AirMsg, b: AirMsg) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id);

/** The planes in the loop or on their way up, oldest first: [0] lands next. */
export const aloft = (air: Air): Flight[] => air.flights.filter((f) => f.phase !== "landing").sort((a, b) => byAge(a.msg, b.msg));

/** The three a fresh page shows (and the List view lists): the newest messages of the last 24 h, oldest first. */
export function inTheAir(messages: AirMsg[], now: number): AirMsg[] {
  const since = localStamp(now - 86_400_000);
  return messages.filter((m) => m.ts >= since).sort(byAge).slice(-AIR_MAX);
}

/** A poll's messages into the air: the seed on the first one; afterwards each new message takes off (FIFO: the oldest
 *  of three lands at the same moment). `instant` (reduced motion, quiet): no take-off or landing, just the result.
 *  Returns the messages that took off. */
export function airPoll(air: Air, messages: AirMsg[], now: number, o: { instant: boolean }): AirMsg[] {
  if (!air.seeded) {
    air.seeded = true;
    const up = inTheAir(messages, now);
    air.flights = [];
    for (const msg of up) air.flights.push({ msg, phase: "loop" as const, start: now, wander: newWander(msg.id, now, air.flights.map((f) => f.wander)) });
    air.seen = new Set(messages.map((m) => m.id));
    return [];
  }
  const fresh = messages.filter((m) => !air.seen.has(m.id)).sort(byAge);
  for (const msg of fresh) {
    const up = aloft(air);
    if (up.length >= AIR_MAX) {
      const oldest = up[0];
      if (o.instant) air.flights = air.flights.filter((f) => f !== oldest);
      else Object.assign(oldest, { phase: "landing", start: now });
    }
    air.flights.push({ msg, phase: o.instant ? "loop" : "takeoff", start: now, wander: newWander(msg.id, now, air.flights.map((f) => f.wander)) });
  }
  // a message that left the newest five cannot come back: remember only what the poll still lists
  air.seen = new Set(messages.map((m) => m.id));
  return fresh;
}

/** Time passing: a take-off that has reached free flight is in it; a landed plane is gone; every plane's path moves on
 *  to its next waypoint, clear of the others'. */
export function airStep(air: Air, now: number) {
  air.flights = air.flights.filter((f) => !(f.phase === "landing" && now - f.start >= LANDING_MS));
  for (const f of air.flights) {
    if (f.phase === "takeoff" && now - f.start >= TAKEOFF_MS) Object.assign(f, { phase: "loop" });
    if (f.phase !== "landing") f.wander = wanderStep(f.wander, now, air.flights.filter((o) => o !== f).map((o) => o.wander));
  }
}

/** A plane's caption: "<from> → <to> · HH:MM". */
export const captionOf = (m: AirMsg) => `${m.from} → ${m.to} · ${m.ts.slice(11, 16)}`;

/** A plane's free flight (owner, 10-31 14:50): from waypoint `a` to `b` in `dur` ms with an eased start and stop, the
 *  next waypoint 6-10 s on at about a tile every 2 s, turning gently (at most ~60 degrees from its heading), inside the
 *  scene and at least a tile from the other planes' waypoints. Seeded by the message id: a replay flies the same. */
export type Wander = { seed: number; n: number; a: Pt; b: Pt; start: number; dur: number; h0: number }; // h0: the last leg's heading
export const AIR_SPEED = 8; // room px a second: about a tile every 2 s
export const AIR_GAP = 16; // a tile between planes
export const AIR_BOX = { x0: 10, y0: 10, x1: COLS * TILE - 10, y1: ROWS * TILE - 12 };
const hashOf = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const clampBox = (p: Pt): Pt => ({ x: Math.max(AIR_BOX.x0, Math.min(AIR_BOX.x1, p.x)), y: Math.max(AIR_BOX.y0, Math.min(AIR_BOX.y1, p.y)) });
const inBox = (p: Pt) => p.x >= AIR_BOX.x0 && p.x <= AIR_BOX.x1 && p.y >= AIR_BOX.y0 && p.y <= AIR_BOX.y1;

function nextLeg(w: { seed: number; n: number; a: Pt; b: Pt }, start: number, others: Wander[]): Wander {
  const heading = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
  const far = (q: Pt) => others.every((o) => Math.hypot(o.b.x - q.x, o.b.y - q.y) >= AIR_GAP * 2 && Math.hypot(o.a.x - q.x, o.a.y - q.y) >= AIR_GAP);
  let n = w.n;
  let best: { b: Pt; dur: number } | null = null;
  for (let tries = 0; tries < 8 && !best; tries++) {
    const dur = 6000 + Math.floor(seeded(w.seed, n++) * 4001);
    const turn = (seeded(w.seed, n++) - 0.5) * (tries < 4 ? 2.1 : 6.28); // gentle first, any way if boxed in
    const len = (AIR_SPEED * dur) / 1000;
    const q = { x: w.b.x + Math.cos(heading + turn) * len, y: w.b.y + Math.sin(heading + turn) * len };
    if (inBox(q) && far(q)) best = { b: q, dur };
  }
  if (!best) {
    // boxed in: head back toward the middle of the scene
    const mid = { x: (AIR_BOX.x0 + AIR_BOX.x1) / 2, y: (AIR_BOX.y0 + AIR_BOX.y1) / 2 };
    const d = Math.hypot(mid.x - w.b.x, mid.y - w.b.y) || 1;
    const len = Math.min(d, AIR_SPEED * 8);
    best = { b: clampBox({ x: w.b.x + ((mid.x - w.b.x) / d) * len, y: w.b.y + ((mid.y - w.b.y) / d) * len }), dur: 8000 };
  }
  return { seed: w.seed, n, a: { ...w.b }, b: best.b, start, dur: best.dur, h0: heading };
}
/** A new plane's path: it starts at a seeded place in the scene clear of the others. */
export function newWander(id: string, now: number, others: Wander[]): Wander {
  const seed = hashOf(id);
  let n = 0;
  let at = clampBox({ x: AIR_BOX.x0 + seeded(seed, n++) * (AIR_BOX.x1 - AIR_BOX.x0), y: AIR_BOX.y0 + seeded(seed, n++) * (AIR_BOX.y1 - AIR_BOX.y0) });
  for (let i = 0; i < 12 && others.some((o) => Math.hypot(o.a.x - at.x, o.a.y - at.y) < AIR_GAP * 3); i++)
    at = clampBox({ x: AIR_BOX.x0 + seeded(seed, n++) * (AIR_BOX.x1 - AIR_BOX.x0), y: AIR_BOX.y0 + seeded(seed, n++) * (AIR_BOX.y1 - AIR_BOX.y0) });
  const dir = seeded(seed, n++) * Math.PI * 2;
  // a first leg out of `at`, heading `dir`
  return nextLeg({ seed, n, a: { x: at.x - Math.cos(dir), y: at.y - Math.sin(dir) }, b: at }, now, others);
}
/** The path moved on to the leg that holds `now` (never stopping: each leg starts where the last ended). */
export function wanderStep(w: Wander, now: number, others: Wander[]): Wander {
  let cur = w;
  for (let i = 0; i < 50 && now >= cur.start + cur.dur; i++) cur = nextLeg(cur, cur.start + cur.dur, others);
  return cur;
}
/** Where a plane is on its path, and its heading. Eased in and out of each waypoint, so turns are smooth; with reduced
 *  motion it drifts a little around its waypoint instead. */
export function wanderAt(w: Wander, now: number, still: boolean): { x: number; y: number; angle: number } {
  if (still) {
    const a = (2 * Math.PI * now) / 9000 + w.seed;
    return { x: w.a.x + Math.cos(a) * 2, y: w.a.y + Math.sin(a) * 1, angle: Math.cos(a) >= 0 ? 0 : Math.PI };
  }
  const k = Math.max(0, Math.min(1, (now - w.start) / w.dur));
  // a smooth path through the waypoints: the leg's chord, eased, with its heading from where it flies
  const e = 0.5 * k + 0.5 * k * k * (3 - 2 * k); // eased, yet never below half speed: it never stops
  const x = w.a.x + (w.b.x - w.a.x) * e;
  const y = w.a.y + (w.b.y - w.a.y) * e;
  // the nose swings from the last leg's heading to this one's over the first 60%: a gentle turn
  const h1 = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
  let dh = h1 - w.h0;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  const turn = Math.min(1, k / 0.6);
  return { x, y, angle: w.h0 + dh * turn * turn * (3 - 2 * turn) };
}
/** Planes a tile apart: any two closer are pushed apart along the line between them (three passes), then kept in
 *  the scene. */
export function separate(ps: { x: number; y: number }[], gap = AIR_GAP): { x: number; y: number }[] {
  const out = ps.map((p) => ({ ...p }));
  for (let pass = 0; pass < 6; pass++)
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        const ux = d ? dx / d : 1;
        const uy = d ? dy / d : 0;
        const push = (gap - d) / 2 + 0.01;
        out[i] = { ...out[i], x: out[i].x - ux * push, y: out[i].y - uy * push };
        out[j] = { ...out[j], x: out[j].x + ux * push, y: out[j].y + uy * push };
      }
  return out;
}

/** A short label with handles ("outA → ceoA", "→ all" for everyone, "→ owner"), for the List view's "In the air". */
export function airLabel(m: AirMsg, handleOf: (name: string) => string): string {
  const who = (name: string) => (/^owner$/i.test(name) ? "owner" : /^(everyone|all)$/i.test(name) ? "all" : handleOf(name));
  return `${who(m.from)} → ${who(m.to)}`;
}

/** A take-off's three legs at time `k` (0..1 of TAKEOFF_MS): to the receiver, the touch there, up into the loop. */
export function takeoffLeg(k: number): { leg: "out" | "touch" | "up"; k: number } {
  const out = 1600 / TAKEOFF_MS;
  const touch = 2000 / TAKEOFF_MS;
  if (k < out) return { leg: "out", k: k / out };
  if (k < touch) return { leg: "touch", k: (k - out) / (touch - out) };
  return { leg: "up", k: Math.min(1, (k - touch) / (1 - touch)) };
}

// ---- Personalities (queue 47 part 2; owner, 10-31: "individual personality") ----
// One look per member that reads from across the room: a prop it carries in every pose (standing, sitting, walking,
// asleep on its mat and in the List view's portrait), and a signature move played on its real actions (queue 40's
// animations, with its own prop). The CEO paces with a clipboard and checks its watch; Lead Gen sweeps the horizon with
// binoculars; the Enricher peers through a magnifying glass; the Writer types fast and tosses crumpled paper into a
// bin by its wall (one ball per accepted draft today, empty again at midnight); the Package Designer sketches on a pad
// and holds it up on a publish; the Research Analyst reads a thick book and pushes up its glasses on a note; Scout
// wears a backpack and a compass that spins on a search; the Onion Reader wears a trench coat and keeps an umbrella that
// opens in the rain. Shirts stay their colours: the coat is open over it.
export type Gear = "clipboard" | "watch" | "binoculars" | "magnifier" | "pencil" | "sketchpad" | "book" | "glasses" | "backpack" | "compass" | "trenchcoat" | "umbrella";
export type Move = "watch" | "sweep" | "magnify" | "toss" | "holdup" | "glasses" | "compass";
export const PERSONAS: Record<string, { gear: Gear[]; moves: Partial<Record<ActAnim, Move>> }> = {
  "the-ceo": { gear: ["clipboard", "watch"], moves: { clipboard: "watch", propose: "watch", flag: "watch" } },
  "lead-gen": { gear: ["binoculars"], moves: { binoculars: "sweep", tablet: "sweep" } },
  "lead-enricher": { gear: ["magnifier"], moves: { pin: "magnify", tablet: "magnify", binoculars: "magnify" } },
  "outreach-writer": { gear: ["pencil"], moves: { pin: "toss" } },
  "package-designer": { gear: ["sketchpad"], moves: { flag: "holdup", laptop: "holdup" } },
  "research-analyst": { gear: ["book", "glasses"], moves: { laptop: "glasses" } },
  scout: { gear: ["backpack", "compass"], moves: { binoculars: "compass" } },
  "onion-reader": { gear: ["trenchcoat", "umbrella"], moves: {} },
};
export const gearOf = (slug: string): Gear[] => PERSONAS[slug]?.gear ?? [];
/** The gear in words, for the Info card's first line ("Lead Gen · binoculars"). */
const GEAR_WORDS: Record<Gear, string> = { clipboard: "clipboard", watch: "watch", binoculars: "binoculars", magnifier: "magnifying glass", pencil: "pencil", sketchpad: "sketch pad", book: "book", glasses: "glasses", backpack: "backpack", compass: "compass", trenchcoat: "trench coat", umbrella: "umbrella" };
export const gearWords = (slug: string) => gearOf(slug).map((g) => GEAR_WORDS[g]).join(" & ");
/** The signature move a real action plays for this member (its own prop), or null: the queue 40 animation then. */
export const moveOf = (slug: string, kind: ActAnim): Move | null => PERSONAS[slug]?.moves[kind] ?? null;

export const BIN_MAX = 12;
/** The Writer's bin: one crumpled ball per accepted draft today (its own-output count, which starts again at midnight). */
export const binCount = (c: { slug: string; output: { label: string; today: number } | null }) =>
  c.slug === "outreach-writer" && c.output?.label === "draft" ? Math.max(0, Math.min(BIN_MAX, c.output.today)) : 0;

/** One rectangle of a prop, relative to the figure's feet: [dx, dy, w, h, colour]. */
export type GearRect = [number, number, number, number, string];
const WOOD = "#8a6544";
const PAPER = "#fffaf0";
const DARK = "#2b2b2b";
const COAT = "#b39b6b";
/** The pixels of one prop for a pose (lying: small, beside the pillow). `rain` opens the umbrella. `held` false leaves
 *  out what is in the hand (a signature move draws it raised instead). */
export function gearRects(g: Gear, pose: string, o: { rain?: boolean; held?: boolean } = {}): GearRect[] {
  const held = o.held ?? true;
  if (pose === "lie") {
    const small: Partial<Record<Gear, GearRect[]>> = {
      clipboard: [[12, -3, 3, 4, WOOD], [13, -2, 1, 2, PAPER]],
      binoculars: [[12, -2, 2, 2, DARK], [14, -2, 2, 2, DARK]],
      magnifier: [[12, -3, 3, 3, "#c9c4b8"], [13, -2, 1, 1, "#9fd3e8"], [15, 0, 2, 1, "#6b4a2f"]],
      pencil: [[12, -1, 4, 1, "#f2c94c"]],
      sketchpad: [[12, -3, 4, 4, PAPER], [12, -3, 4, 1, "#8a5cc7"]],
      book: [[12, -3, 4, 3, "#7a2f2f"], [12, -3, 4, 1, PAPER]],
      backpack: [[12, -3, 3, 4, "#6b4a2f"]],
      umbrella: [[12, -1, 6, 1, DARK]],
      trenchcoat: [[-5, -4, 16, 2, COAT]],
    };
    return small[g] ?? [];
  }
  const sit = pose === "sit";
  const hy = sit ? -7 : -6; // the right hand's height
  const O = "#1b1b1b"; // the outline every prop gets, so it reads at a glance (queue 52)
  switch (g) {
    case "clipboard": // a white sheet on a brown board with a red clip
      return held ? [[4, hy - 6, 6, 8, O], [5, hy - 5, 4, 6, "#ffffff"], [6, hy - 7, 2, 2, "#d63b3b"], [5, hy - 3, 3, 1, "#9a9a9a"], [5, hy - 1, 3, 1, "#9a9a9a"]] : [];
    case "watch":
      return [[-6, -7, 2, 2, O], [-6, -7, 1, 1, "#f2c94c"]];
    case "binoculars": // two dark lenses with white glints, on a strap at the chest
      return [[-4, -10, 8, 4, O], [-3, -9, 2, 2, "#4a4a4a"], [1, -9, 2, 2, "#4a4a4a"], [-3, -9, 1, 1, "#ffffff"], [1, -9, 1, 1, "#ffffff"], [-4, -11, 1, 1, O], [3, -11, 1, 1, O]];
    case "magnifier": // a ring on a stick
      return held ? [[4, hy - 8, 6, 6, O], [5, hy - 7, 4, 4, "#bfe6f5"], [5, hy - 7, 1, 1, "#ffffff"], [6, hy - 2, 2, 5, "#6b4a2f"]] : [];
    case "pencil": // a yellow pencil behind the ear
      return [[4, -20, 2, 7, O], [4, -19, 2, 5, "#f2c94c"], [4, -20, 2, 1, "#e57373"], [4, -14, 2, 1, "#3b3b3b"]];
    case "sketchpad": // a white pad with a purple spiral and a doodle
      return held ? [[4, hy - 7, 7, 8, O], [5, hy - 6, 5, 6, "#ffffff"], [5, hy - 7, 5, 1, "#8a5cc7"], [6, hy - 4, 3, 1, "#ff6600"], [6, hy - 2, 2, 1, "#8a5cc7"]] : [];
    case "book": // a thick red book, its pages showing
      return held ? [[4, hy - 5, 6, 7, O], [5, hy - 4, 4, 5, "#c0392b"], [8, hy - 4, 1, 5, "#fffaf0"], [5, hy - 4, 1, 1, "#e57373"]] : [];
    case "glasses":
      return [[-4, -14, 3, 2, O], [1, -14, 3, 2, O], [-1, -14, 2, 1, O], [-3, -13, 1, 1, "#bfe6f5"], [2, -13, 1, 1, "#bfe6f5"]];
    case "backpack": // a coloured block on the back with its straps
      return [[-8, -12, 5, 9, O], [-7, -11, 3, 7, "#d35400"], [-7, -11, 1, 1, "#f39c5a"], [-7, -7, 3, 1, "#8e3b00"], [-4, -10, 1, 4, "#8e3b00"]];
    case "compass":
      return held ? [[4, hy - 4, 5, 5, O], [5, hy - 3, 3, 3, "#e0e0e0"], [6, hy - 3, 1, 1, "#d63b3b"], [6, hy - 2, 1, 1, "#3b3b3b"]] : [];
    case "trenchcoat": // a long tan silhouette, open over the shirt, down to the shins, collar up, belted
      return [[-6, -12, 3, 11, "#c2a46e"], [3, -12, 3, 11, "#c2a46e"], [-6, -12, 1, 11, "#6b5530"], [5, -12, 1, 11, "#6b5530"], [-6, -13, 3, 1, "#6b5530"], [3, -13, 3, 1, "#6b5530"], [-6, -6, 12, 1, "#6b5530"]];
    case "umbrella":
      if (o.rain) return [[-8, -26, 16, 3, O], [-7, -25, 14, 1, "#3b4a9e"], [-5, -27, 10, 1, O], [5, -23, 1, 17, "#5b5b5b"]];
      return held ? [[5, -17, 2, 15, O], [5, -17, 1, 13, "#4a4a4a"], [4, -2, 3, 1, O], [5, -18, 1, 1, "#9a9a9a"]] : [];
  }
}
/** Every prop of a member for a pose, in drawing order. */
export const personaRects = (slug: string, pose: string, o: { rain?: boolean; held?: boolean } = {}): GearRect[] => gearOf(slug).flatMap((g) => gearRects(g, pose, o));
/** The CEO paces at its screen while it works: a small sway left and right (draw-only, room px). */
export const paceOffset = (slug: string, t: number, working: boolean) => (slug === "the-ceo" && working ? Math.round(Math.sin(t / 1600) * 3) : 0);

// ---- Pranks as filler (queue 47 part 4; owner, 10-31: the world is watched as a video) ----
// Eligibility is per member, not per family (queue 57; owner, 19:20: "I do not see any mischief"; six bots acting every
// 1-3 minutes never left the family-wide 90 s of silence the old rule asked for): a member that is resting or idle, or
// working but between steps (its last action 30 s or more ago, its next step at least 25 s away, so a 90 s cycle
// qualifies), and was in no gag in the last 5 minutes, may play. Two of them within 7 tiles (one for the solo gags)
// play a short gag, 4-6 s, one at a time, at most one every 2 minutes in the room (never a stalled, blocked or quiet member; the
// stopped ones under the tree only as the one dozing when a resting member pokes it): a paper ball thrown
// and dodged; one dozes and the other pokes it awake; a swapped tea cup and a double take; a boat trip for a resting
// member (rows out, comes back); skipping stones with a ripple count; the Onion Reader's umbrella opening on a sunny
// day. The choice is a seeded random, so a replay plays the same gags. A real action by one of its actors ends a gag at
// once; other members' actions do not. Reduced motion or quiet: no gags.
export type GagKind = "paperball" | "poke" | "teacup" | "boat" | "stones" | "umbrella";
export type Gag = { kind: GagKind; actors: string[]; start: number; until: number; skips: number };
export type Pranks = { seed: number; n: number; lastGag: number; gag: Gag | null; recent: Record<string, number> };
export const PRANK_EVERY_MS = 120_000; // one gag every 2 minutes in the room
export const PRANK_REST_MS = 300_000; // a member is in at most one gag every 5 minutes
export const PRANK_SETTLE_MS = 20_000; // the first gag no sooner than 20 s after the page opens: everyone walks in first
export const BETWEEN_SINCE_MS = 30_000;
export const BETWEEN_LEFT_MS = 25_000;
/** Working but between steps: its last action 30 s or more ago and its next step at least 25 s away (queue 57). */
export function betweenSteps(lastTs: string | null | undefined, cycleSec: number | null | undefined, now: number): boolean {
  if (!lastTs || !cycleSec) return false;
  const since = now - new Date(lastTs).getTime();
  return since >= BETWEEN_SINCE_MS && cycleSec * 1000 - since >= BETWEEN_LEFT_MS;
}
/** Why a working member is not between steps, in words, or null when it is (queue 57: window.__worldGagWhy). */
export function betweenWhy(lastTs: string | null | undefined, cycleSec: number | null | undefined, now: number, since0 = BETWEEN_SINCE_MS, left0 = BETWEEN_LEFT_MS): string | null {
  if (!lastTs) return "working, no action yet";
  if (!cycleSec) return "working, its cycle is unknown";
  const since = now - new Date(lastTs).getTime();
  if (cycleSec * 1000 < since0 + left0) return `cycle too short (${cycleSec} s < ${(since0 + left0) / 1000} s)`;
  if (since < since0) return `not between steps: acted ${Math.round(since / 1000)} s ago`;
  if (cycleSec * 1000 - since < left0) return `not between steps: next step in ${Math.max(0, Math.round((cycleSec * 1000 - since) / 1000))} s`;
  return null;
}

/** Why no gag starts now, for a check (queue 57): the room's reason (null when the room allows one) and each member's
 *  (null when it may take part). `between` is betweenWhy's answer for a working member. */
export function gagWhy(
  pr: Pranks,
  now: number,
  members: { slug: string; anim: Anim; between?: string | null }[],
): { room: string | null; members: Record<string, string | null> } {
  const out: Record<string, string | null> = {};
  for (const m of members) {
    const was = pr.recent[m.slug];
    out[m.slug] =
      was !== undefined && now - was < PRANK_REST_MS ? `in a gag ${Math.round((now - was) / 1000)} s ago (one every ${PRANK_REST_MS / 60000} min)`
      : GAG_ELIGIBLE.has(m.anim) ? null
      : m.anim === "working" ? (m.between ?? null)
      : m.anim;
  }
  const room =
    pr.gag ? `a gag is playing (${pr.gag.kind})`
    : now - pr.lastGag < PRANK_EVERY_MS ? (pr.lastGag > 0 && pr.recent && Object.keys(pr.recent).length ? `spacing: last gag ${Math.round((now - pr.lastGag) / 1000)} s ago` : "settling in after the page opened")
    : null;
  return { room, members: out };
}

export const newPranks = (seed: number, now: number): Pranks => ({ seed, n: 0, lastGag: now - PRANK_EVERY_MS + PRANK_SETTLE_MS, gag: null, recent: {} });

/** A small seeded generator (mulberry32): the same seed and draw number give the same number in [0, 1). */
export function seeded(seed: number, n: number): number {
  let a = (seed + Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const GAG_ELIGIBLE = new Set<Anim>(["resting", "idle"]);
const PAIR_MAX = 7; // tiles: two members further apart than this do not play a two-person gag

/** One tick of the filler: `real` lists the members whose real action played since the last tick (one of the actors:
 *  the gag ends at once). Returns the gag playing now, or null. `pos` is where each member stands (for a near pair). */
export function prankStep(
  pr: Pranks,
  now: number,
  members: { slug: string; anim: Anim; pos: Pt; atShore: boolean; between?: boolean }[],
  o: { real: string[]; quiet: boolean; still: boolean; rain: boolean; day: boolean },
  sleepers: { slug: string; pos: Pt }[] = [],
): Gag | null {
  if (pr.gag && pr.gag.actors.some((s) => o.real.includes(s))) pr.gag = null;
  if (o.quiet || o.still) {
    pr.gag = null;
    return null;
  }
  const can = members.filter((m) => GAG_ELIGIBLE.has(m.anim) || (m.anim === "working" && m.between)).sort((a, b) => a.slug.localeCompare(b.slug));
  if (pr.gag) {
    const still = pr.gag.actors.every((s) => can.some((m) => m.slug === s) || (pr.gag!.kind === "poke" && sleepers.some((z) => z.slug === s)));
    if (now < pr.gag.until && still) return pr.gag;
    pr.gag = null;
  }
  const rested = (slug: string) => pr.recent[slug] === undefined || now - pr.recent[slug] >= PRANK_REST_MS;
  const ok = can.filter((m) => rested(m.slug));
  if (now - pr.lastGag < PRANK_EVERY_MS || !ok.length) return null;
  const rnd = () => seeded(pr.seed, pr.n++);
  const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const first = ok[Math.floor(rnd() * ok.length)];
  const partner = ok.filter((m) => m !== first && dist(m.pos, first.pos) <= PAIR_MAX).sort((a, b) => dist(a.pos, first.pos) - dist(b.pos, first.pos))[0];
  // a sleeper under the tree only as the one dozing, and only when a resting member does the poking
  const dozer = !partner && first.anim === "resting" ? sleepers.filter((z) => rested(z.slug) && dist(z.pos, first.pos) <= PAIR_MAX).sort((a, b) => dist(a.pos, first.pos) - dist(b.pos, first.pos))[0] : undefined;
  const kinds: GagKind[] = [];
  if (partner) kinds.push("paperball", "poke", "teacup");
  else if (dozer) kinds.push("poke");
  if (first.anim === "resting" && first.atShore) kinds.push("boat", "stones");
  if (first.slug === "onion-reader" && !o.rain && o.day) kinds.push("umbrella");
  if (!kinds.length) return null;
  const kind = kinds[Math.floor(rnd() * kinds.length)];
  const length = 4000 + Math.floor(rnd() * 2001);
  const skips = 2 + Math.floor(rnd() * 4);
  const actors = kind === "paperball" || kind === "poke" || kind === "teacup" ? [first.slug, (partner ?? dozer)!.slug] : [first.slug];
  pr.gag = { kind, actors, start: now, until: now + length, skips };
  pr.lastGag = now;
  for (const a of actors) pr.recent[a] = now;
  return pr.gag;
}

/** What a gag does to one figure at time `now`: a dodge sideways, gone (out in the boat), the umbrella open, a sign
 *  over its head ("!" woken, "?" puzzled). */
export function gagFigure(g: Gag | null, slug: string, now: number): { dx: number; hide: boolean; umbrella: boolean; sign: "!" | "?" | null } {
  const none = { dx: 0, hide: false, umbrella: false, sign: null };
  if (!g || !g.actors.includes(slug) || now >= g.until) return none;
  const k = (now - g.start) / (g.until - g.start);
  const target = g.actors[1] === slug;
  switch (g.kind) {
    case "paperball":
      return { ...none, dx: target && k > 0.5 && k < 0.8 ? -4 : 0, sign: target && k >= 0.8 ? "!" : null };
    case "poke":
      return { ...none, sign: target && k >= 0.6 ? "!" : null };
    case "teacup":
      return { ...none, sign: target && k >= 0.65 ? "?" : null };
    case "boat":
      return { ...none, hide: k > 0.08 && k < 0.92 };
    case "umbrella":
      return { ...none, umbrella: true, sign: k >= 0.5 ? "?" : null };
    default:
      return none;
  }
}
/** The boat's way out and back during a boat trip (px left of its mooring), 0 otherwise. */
export const boatOut = (g: Gag | null, now: number) => (g?.kind === "boat" && now < g.until ? Math.round(Math.sin(Math.PI * Math.min(1, (now - g.start) / (g.until - g.start))) * 70) : 0);

// ---- Made for video (queue 47 part 5; owner, 10-31: the world will be watched and sold) ----
// All off by default and remembered per browser: a director's picture-in-picture inset, a ticker of live numbers along
// the bottom, a 10x time-lapse of day and night in director mode (visual only), and "Record 60 s" (the canvas, inset and
// ticker included, to a WebM download; nothing is uploaded).

/** The director: whoever acted gets 2x for 3 s, then the next who acted; nobody: a slow pan across the scene. */
export type Director = { queue: string[]; focus: string | null; since: number };
export const DIRECTOR_HOLD_MS = 3000;
export const newDirector = (): Director => ({ queue: [], focus: null, since: 0 });
export function directorStep(d: Director, now: number, acted: string[], present: string[]): Director {
  const here = new Set(present);
  const queue = [...d.queue];
  for (const s of acted) if (s !== d.focus && !queue.includes(s)) queue.push(s);
  if (d.focus && here.has(d.focus) && now - d.since < DIRECTOR_HOLD_MS) return { ...d, queue };
  while (queue.length && !here.has(queue[0])) queue.shift();
  const next = queue.shift() ?? null;
  if (next === null && d.focus === null) return { queue, focus: null, since: d.since };
  return { queue, focus: next, since: now };
}
/** The idle pan: 0..1 across the scene and back, once a minute. */
export const panAt = (now: number) => {
  const k = (now / 60_000) % 1;
  return k < 0.5 ? k * 2 : 2 - k * 2;
};
/** What the inset shows, room px: a third of the scene's size at 2x, centred on the focus's head (or panning),
 *  clamped to the scene. */
export function insetSource(focus: Pt | null, now: number): Rect {
  const W = COLS * TILE;
  const H = ROWS * TILE;
  const w = W / 6;
  const h = H / 6;
  const cx = focus ? focus.x : w / 2 + panAt(now) * (W - w);
  const cy = focus ? focus.y - 10 : H * 0.6; // the pan follows the first row of people
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h };
}

/** The ticker's line: leads today, drafts today, pages opened, refused share, planes in the air. */
export function tickerText(cards: { output: { label: string; today: number } | null; refusedShare: number | null; actionsToday: number }[], opens: number | null, inAir: number, allowance: string[] = [], portalLocal: { url: string } | null = null): string {
  const sum = (label: string) => cards.reduce((n, c) => n + (c.output?.label === label ? c.output.today : 0), 0);
  const acts = cards.reduce((n, c) => n + c.actionsToday, 0);
  const refused = cards.reduce((n, c) => n + (c.refusedShare ?? 0) * c.actionsToday, 0);
  const parts = [`Leads today ${sum("lead")}`, `Drafts today ${sum("draft")}`, `Pages opened ${opens ?? "-"}`, `Refused ${acts ? Math.round((100 * refused) / acts) : 0}% of actions`, `In the air ${inAir}`];
  // queue 230: a provider dead or above 90% leads the line; a click on the ticker opens the Allowance list
  if (allowance.length) parts.unshift(`Allowance: ${allowance.join(", ")} (click for the list)`);
  // queue 294: the team portal running on this Mac leads the line, with the address the team uses
  if (portalLocal) parts.unshift(`Portal (local mode): ${portalLocal.url || "the tunnel is not up yet"}`);
  return parts.join("   ·   ");
}
export const TICKER_H = 9;
/** Where the video parts go (queue 50: they never cover the scene): a strip under the scene, the director's inset on
 *  the left with a caption beside it, the ticker along the whole width under them. Room px; `height` is the canvas's. */
export function videoLayout(v: { director: boolean; ticker: boolean }): { height: number; inset: Rect | null; caption: Rect | null; ticker: Rect | null } {
  const W = COLS * TILE;
  const Hs = ROWS * TILE;
  const inset = v.director ? { x: 4, y: Hs + 4, w: 128, h: 85 } : null;
  const caption = v.director ? { x: 140, y: Hs + 4, w: W - 144, h: 85 } : null;
  const top = Hs + (v.director ? 93 : 2); // clear of the shadows under feet on the front edge
  const ticker = v.ticker ? { x: 0, y: top, w: W, h: TICKER_H } : null;
  return { height: v.ticker ? top + TICKER_H : Hs + (v.director ? 93 : 0), inset, caption, ticker };
}
export const TICKER_SPEED = 14; // px a second
/** The ticker's scroll: it moves on unless the pointer is over it. */
export const tickerScroll = (x: number, dt: number, paused: boolean, width: number) => (paused ? x : (x + TICKER_SPEED * dt) % Math.max(1, width));

/** "Record 60 s": idle, recording until a time, or unsupported (a note that recording needs Chrome, for 6 s). */
export type Rec = { state: "idle" | "recording" | "unsupported"; until: number };
export const REC_MS = 60_000;
export const recStart = (rec: Rec, now: number, supported: boolean): Rec => (rec.state === "recording" ? rec : supported ? { state: "recording", until: now + REC_MS } : { state: "unsupported", until: now + 6000 });
/** Time passing: a recording or a note ends at its time; `stop` says the recorder should stop now. */
export function recTick(rec: Rec, now: number): { rec: Rec; stop: boolean } {
  if (rec.state === "idle" || now < rec.until) return { rec, stop: false };
  return { rec: { state: "idle", until: 0 }, stop: rec.state === "recording" };
}
/** The time-lapse clock: 10x from the hour it started (visual only). */
export const lapseHour = (startHour: number, startT: number, now: number) => (startHour + ((now - startT) * 10) / 3_600_000) % 24;

/** The video toggles, remembered per browser; all off until turned on. */
export type VideoOpts = { director: boolean; ticker: boolean; lapse: boolean };
const VIDEO_KEY = "world-video";
export function savedVideo(): VideoOpts {
  const off = { director: false, ticker: false, lapse: false };
  try {
    const v = JSON.parse(localStorage.getItem(VIDEO_KEY) ?? "{}") as Partial<VideoOpts>;
    return { director: v.director === true, ticker: v.ticker === true, lapse: v.lapse === true };
  } catch {
    return off;
  }
}
export function saveVideo(v: VideoOpts) {
  try {
    localStorage.setItem(VIDEO_KEY, JSON.stringify(v));
  } catch {
    /* private window: not remembered */
  }
}

/** A butterfly's wing colour (queue 51; owner, 10-31 15:20: "instead of paper planes make it butterflies"): the
 *  sender's shirt, orange for the owner's lines, grey for a sender not on the terrace. */
export function wingColor(from: string, cards: { slug: string; name: string }[]): string {
  if (/^owner$/i.test(from)) return "#ff6600";
  const c = cards.find((x) => x.name === from);
  return c ? lookOf(c.slug).shirt : "#8a8a8a";
}

/** What carries a message (queue 51; owner, 15:22: "or even a bee, or both"): a bee for a line from the owner or a
 *  reply to the owner, a butterfly for a message between members or to everyone. */
export const flyerOf = (m: { from: string; to: string }): "bee" | "butterfly" => (/^owner$/i.test(m.from) || /^owner$/i.test(m.to) ? "bee" : "butterfly");
/** A bee's flight on its path (owner, 15:36: "it looks like it's spinning"): no zigzag, a small 1 px bob. */
export const beeBob = (seed: number, t: number) => Math.sin(t / 160 + (seed % 97)) * 1;
// ---- The butterfly (queue 58, from valiCC's review: 12-13 px, mirror-symmetric, two lobes a side with a notch, an
// outline so a navy shirt colour still reads over water and sky, antennae with tips, a 3-frame flap, hops and glides) ----
export type BflyFrame = "open" | "half" | "up";
type Px = [number, number];
// The left wings' pixels, body column at x = 0, head at y = -4; the right side is their mirror (x -> -x).
const BFLY_LEFT: Record<BflyFrame, { upper: Px[]; lower: Px[] }> = {
  open: {
    // upper: rounded, the larger lobe
    upper: [[-4, -5], [-3, -5], [-5, -4], [-4, -4], [-3, -4], [-2, -4], [-5, -3], [-4, -3], [-3, -3], [-2, -3], [-1, -3], [-5, -2], [-4, -2], [-3, -2], [-2, -2], [-1, -2], [-4, -1], [-3, -1], [-2, -1], [-1, -1]],
    // lower: smaller, under the notch at y = 0
    lower: [[-1, 0], [-3, 1], [-2, 1], [-1, 1], [-3, 2], [-2, 2], [-1, 2], [-2, 3]],
  },
  half: {
    upper: [[-2, -6], [-1, -6], [-3, -5], [-2, -5], [-1, -5], [-3, -4], [-2, -4], [-1, -4], [-2, -3], [-1, -3]],
    lower: [[-1, -1], [-2, 0], [-1, 0], [-2, 1], [-1, 1]],
  },
  up: {
    // edge-on over the back
    upper: [[-1, -8], [-1, -7], [-1, -6], [-1, -5]],
    lower: [[-1, -2]],
  },
};
const mirror = (ps: Px[]): Px[] => ps.map(([x, y]) => [-x, y] as Px);
/** Every pixel of a butterfly frame, by layer, relative to its body (x = 0) and head (y = -4). The marker for "lands
 *  next" is a ring under the body, clear of the head. */
export function butterflyPixels(frame: BflyFrame, next = false) {
  const L = BFLY_LEFT[frame];
  const wing = [...L.upper, ...L.lower, ...mirror([...L.upper, ...L.lower])];
  const body: Px[] = [[0, -4], [0, -3], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2]];
  const antennae: Px[] = [[-1, -5], [1, -5], [-1, -6], [1, -6]];
  const tips: Px[] = [[-2, -7], [2, -7]];
  const key = (p: Px) => `${p[0]},${p[1]}`;
  const taken = new Set([...wing, ...body, ...antennae, ...tips].map(key));
  const outline: Px[] = [];
  const seen = new Set<string>();
  for (const [x, y] of wing)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q: Px = [x + dx, y + dy];
      if (!taken.has(key(q)) && !seen.has(key(q))) {
        seen.add(key(q));
        outline.push(q);
      }
    }
  const spots: Px[] = frame === "open" ? [[-3, -3], [3, -3], [-2, 2], [2, 2]] : frame === "half" ? [[-2, -5], [2, -5]] : [];
  const marker: Px[] = next ? [[-1, 5], [0, 5], [1, 5], [-1, 6], [1, 6], [-1, 7], [0, 7], [1, 7]] : [];
  return { outline, wing, spots, body, antennae, tips, marker };
}
/** Flap frame at time t: open, half, up, half, about 5 Hz; held open while it glides. */
export const flapFrame = (t: number, glide: boolean): BflyFrame => (glide ? "open" : (["open", "half", "up", "half"] as const)[Math.floor(t / 50) % 4]);
/** Small irregular hops and short glides instead of a sine bob: each 0.9 s slot is a seeded glide (flat, wings open) or
 *  a hop of 1-3 px, up quickly, down slowly. */
export function butterflyHop(seed: number, t: number): { dy: number; glide: boolean } {
  const SLOT = 900;
  const n = Math.floor(t / SLOT);
  const k = t / SLOT - n;
  const a = seeded(seed, n);
  if (a < 0.3) return { dy: 0, glide: true };
  const amp = 1 + Math.round(seeded(seed + 1, n) * 2);
  const rise = 0.2 + seeded(seed + 2, n) * 0.15;
  const dy = k < rise ? -amp * (k / rise) : -amp * (1 - (k - rise) / (1 - rise));
  return { dy: Math.round(dy * 2) / 2, glide: k > rise + 0.2 };
}

/** How an insect faces and leans: it flips left or right with its way and tilts at most 15 degrees, never rotating
 *  further. */
export function insectPose(angle: number): { face: 1 | -1; tilt: number } {
  const face: 1 | -1 = Math.cos(angle) < 0 ? -1 : 1;
  const lean = Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle)));
  const max = (15 * Math.PI) / 180;
  return { face, tilt: Math.max(-max, Math.min(max, lean)) };
}
/** The card a hovered (or, under 1024 px, tapped) butterfly or bee shows (queue 51): "<from> → <to>" in full names,
 *  the time, then the message's first 120 characters. */
export const insectCard = (m: AirMsg): string[] => [`${m.from} → ${m.to}`, m.ts.slice(11, 16), m.text120 || m.text60];
export const CARD_W = 128;
export const INSECT_HIT = 8; // half of the 16 px box a hover or tap finds it in
/** Where the card goes, room px: above the insect (below it near the top), inside the scene, `h` tall. */
export function cardRect(at: Pt, h: number): Rect {
  const W = COLS * TILE;
  const Hs = ROWS * TILE;
  const x = Math.max(2, Math.min(W - CARD_W - 2, at.x - CARD_W / 2));
  const above = at.y - 10 - h;
  const y = above >= 2 ? above : Math.min(Hs - h - 2, at.y + 10);
  return { x, y, w: CARD_W, h };
}
/** The insect a pointer or tap at (x, y) finds: the nearest within its 16 px box. */
export function insectAt<T extends { x: number; y: number }>(shown: T[], x: number, y: number): T | null {
  return shown.filter((b) => Math.abs(b.x - x) <= INSECT_HIT && Math.abs(b.y - y) <= INSECT_HIT).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] ?? null;
}

// ---- Busy between steps (queue 53; owner, 10-31 15:33: "while working they seem to be not doing anything") ----
// A working member at its place never stands still between its real actions: it keeps at what its last action was,
// with its own prop. After a search it scans the horizon (binoculars, or Scout's compass); after a page it reads its
// tablet and flicks it every 2 s; after a write it types at its screen in bursts; after a message it looks toward the
// one it wrote to; after a task or a plan it writes on a clipboard and checks the time. The Designer sketches, the
// Analyst turns a page, the Enricher moves its magnifying glass. Every 10-20 s a little life: a stretch, a sip of tea,
// two steps and back. It plays only while the state is "working" and no real action is playing (a real action, a rest,
// a hold or a stall wins at once); reduced motion holds the pose.
export type BusyKind = "scan" | "tablet" | "type" | "look" | "clipboard" | "sketch" | "page" | "magnify";
export type Busy = { what: BusyKind | "stretch" | "sip" | "pace"; pose: "stand" | "type" | "use" | "stretch" | "sip" | "walk"; prop: string | null; k: number; facing: 1 | -1 | null; dx: number };
const PAGE_KINDS = new Set(["open", "follow", "read", "back"]);
const DESK_KINDS = new Set(["note", "summarize", "package", "draft", "entry", "journal", "lead", "update_lead", "say", "interest", "provider", "publish_package", "publish", "revise_goal"]);
const PLAN_KINDS = new Set(["task", "update_task", "plan", "update_plan", "propose"]);
/** The loop a last action leads to, before the member's own way of doing it. */
export function busyKindOf(slug: string, actType: string | null | undefined): BusyKind {
  const t = actType ?? "";
  if (slug === "package-designer" && (DESK_KINDS.has(t) || PAGE_KINDS.has(t))) return "sketch";
  if (slug === "research-analyst" && (PAGE_KINDS.has(t) || t === "note")) return "page";
  if (slug === "lead-enricher" && (PAGE_KINDS.has(t) || t === "update_lead")) return "magnify";
  if (t === "search") return "scan";
  if (PAGE_KINDS.has(t)) return "tablet";
  if (t === "message") return "look";
  if (PLAN_KINDS.has(t)) return "clipboard";
  return "type";
}
/** What a member does now between its steps, or null (not working, or a real action is playing). `toward`: which way
 *  the one it last wrote to stands (for "look"). */
export function busyOf(o: { slug: string; anim: Anim; actType: string | null | undefined; t: number; still: boolean; playing: boolean; toward?: 1 | -1 }): Busy | null {
  if (o.anim !== "working" || o.playing) return null;
  const kind = busyKindOf(o.slug, o.actType);
  if (o.still) return { what: kind, pose: kind === "type" ? "type" : "stand", prop: null, k: 0, facing: null, dx: 0 };
  // a little life every 10-20 s, for 1.5 s
  const h = (() => {
    let x = 2166136261;
    for (const ch of o.slug) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
    return x;
  })();
  const n = Math.floor(o.t / 15_000);
  const start = n * 15_000 + Math.floor(seeded(h, n) * 5000); // within each 15 s: 10-20 s apart
  if (o.t >= start && o.t < start + 1500) {
    const life = (["stretch", "sip", "pace"] as const)[Math.floor(seeded(h, n + 7919) * 3)];
    const k = (o.t - start) / 1500;
    if (life === "pace") return { what: "pace", pose: "walk", prop: null, k, facing: k < 0.5 ? 1 : -1, dx: Math.round(Math.sin(Math.PI * k) * 6) };
    return { what: life, pose: life, prop: null, k, facing: null, dx: 0 };
  }
  const cyc = (ms: number) => (o.t % ms) / ms;
  switch (kind) {
    case "scan": // slow head turns, the binoculars (or the compass) up
      return { what: kind, pose: "stand", prop: o.slug === "scout" ? "compass" : "sweep", k: cyc(4000), facing: cyc(5000) < 0.5 ? 1 : -1, dx: 0 };
    case "tablet": // reading, a thumb flick every 2 s
      return { what: kind, pose: "use", prop: "tablet", k: cyc(2000), facing: null, dx: 0 };
    case "type": // in bursts: 1.6 s typing, 0.9 s looking at it
      return { what: kind, pose: cyc(2500) < 0.64 ? "type" : "stand", prop: null, k: cyc(2500), facing: null, dx: 0 };
    case "look":
      return { what: kind, pose: "stand", prop: null, k: 0, facing: o.toward ?? 1, dx: 0 };
    case "clipboard": // writing, and every 6 s a look at the watch
      return { what: kind, pose: "use", prop: cyc(6000) > 0.8 ? "watch" : "clipboard", k: cyc(6000), facing: null, dx: 0 };
    case "sketch":
      return { what: kind, pose: "use", prop: "sketch", k: cyc(1200), facing: null, dx: 0 };
    case "page": // reading the book, a page turned every 3 s
      return { what: kind, pose: "use", prop: "page", k: cyc(3000), facing: null, dx: 0 };
    case "magnify":
      return { what: kind, pose: "stand", prop: "magnify", k: cyc(3000), facing: null, dx: 0 };
  }
}

/** A member's HTML screen box by its CSS width (creatorCC queue 258): "full" (the four lines and the footer, 14 px)
 *  from 120 px, "compact" (the tab and the item over up to three 13 px lines) from 80 px, "tiny" under that (phone
 *  width: the box keeps its size in the room and the item takes the 13 px lines that fit). */
export function screenForm(width: number, height: number): { form: "full" | "compact" | "tiny"; lines: number } {
  if (width >= 120) return { form: "full", lines: 4 };
  if (width >= 80) return { form: "compact", lines: 3 };
  return { form: "tiny", lines: Math.max(1, Math.floor((height - 8) / (13 * 1.2))) };
}
